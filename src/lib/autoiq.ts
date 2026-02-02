import { ITrade } from '@/models/Trade';
import { IUser } from '@/models/User';
import { IFollowPurchase } from '@/models/FollowPurchase';
import { IBrokerConnection } from '@/models/BrokerConnection';
import { FollowedTradeAction } from '@/models/FollowedTradeAction';
import { Trade } from '@/models/Trade';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';
import { FollowPurchase } from '@/models/FollowPurchase';
import { Types } from 'mongoose';
import { createBroker } from '@/lib/brokers/factory';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import { decrypt } from '@/lib/encryption';
import { triggerUserEvent } from '@/lib/realtime/pusherServer';
// Removed Massive.com API - using broker execution prices directly

type SnapTradeOrderDetail = {
    execution_price?: number | null;
    time_placed?: string | null;
    time_executed?: string | null;
    status?: string | null;
    orders?: Array<{
        execution_price?: number | null;
        time_placed?: string | null;
        time_executed?: string | null;
        status?: string | null;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
};

async function waitForSnapTradeExecutionPrice(params: {
    brokerConnection: IBrokerConnection;
    brokerageOrderId: string;
    maxWaitMs: number;
}): Promise<{ executionPrice: number; executedAt?: Date } | null> {
    const { brokerConnection, brokerageOrderId, maxWaitMs } = params;

    const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
    const clientId = process.env.SNAPTRADE_CLIENT_ID;
    if (!consumerKey || !clientId) return null;
    if (!brokerConnection.accountId) return null;

    const snaptrade = new Snaptrade({ consumerKey, clientId });
    const userSecret = decrypt(brokerConnection.snaptradeUserSecret);

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            const detailResp = await snaptrade.accountInformation.getUserAccountOrderDetail({
                accountId: brokerConnection.accountId,
                userId: brokerConnection.snaptradeUserId,
                userSecret,
                brokerage_order_id: brokerageOrderId,
            });

            const detail = detailResp.data as SnapTradeOrderDetail;
            const order = Array.isArray(detail?.orders) && detail.orders.length > 0 ? detail.orders[0] : detail;

            const exec = order?.execution_price;
            if (exec !== null && exec !== undefined) {
                const execNum = typeof exec === 'number' ? exec : Number(exec);
                if (Number.isFinite(execNum) && execNum > 0) {
                    const time = order?.time_executed || order?.time_placed || null;
                    return {
                        executionPrice: execNum,
                        executedAt: time ? new Date(time) : undefined,
                    };
                }
            }

            // If broker reports a terminal status, stop waiting.
            const status = (order?.status || '').toUpperCase();
            if (status && status !== 'PENDING') {
                // If FILLED/EXECUTED but no execution_price yet, keep waiting until timeout
                // Otherwise stop for clearly terminal non-fill statuses.
                if (!['FILLED', 'EXECUTED'].includes(status)) {
                    return null;
                }
            }
        } catch {
            // Ignore and keep polling until timeout
        }

        // Poll at a conservative interval to avoid hammering the API
        await new Promise((r) => setTimeout(r, 500));
    }

    return null;
}

/** Order params shared between creator and followers for parallel broker execution */
export type AutoIQOrderParams = {
    ticker: string;
    strike: number;
    optionType: 'C' | 'P';
    expiryDate: Date;
    contracts: number;
    optionContract?: string;
    refPrice?: number;
    refTimestamp?: Date;
};

/** Result of a successful follower broker order (used to persist trade after creator trade exists) */
export type FollowerBrokerResult = {
    follower: IUser;
    brokerConnection: IBrokerConnection;
    executionPrice: number;
    executedAt?: Date;
    /** True when execution price came from broker; false when we used creator fallback (fast path). */
    priceFromBroker: boolean;
    brokerOrderId: string;
    brokerOrderDetails: Record<string, unknown>;
    brokerCostInfo: {
        grossCost: number;
        commission: number;
        estimatedFees: Record<string, number>;
        totalCost: number;
    };
};

/**
 * Get followers eligible for AutoIQ (active follow, hasAutoIQ, auto-trade mode) with their broker connections.
 */
export async function getEligibleAutoIQFollowersWithBrokers(
    creatorUser: IUser
): Promise<Array<{ follower: IUser; brokerConnection: IBrokerConnection }>> {
    if (!creatorUser?.whopUserId) return [];

    const activeFollows = await FollowPurchase.find({
        capperWhopUserId: creatorUser.whopUserId,
        status: 'active',
        $expr: { $lt: ['$numPlaysConsumed', '$numPlaysPurchased'] },
    }).lean();

    if (activeFollows.length === 0) return [];

    const followerWhopUserIds = [...new Set(activeFollows.map((f) => f.followerWhopUserId))];
    const followers = await User.find({
        whopUserId: { $in: followerWhopUserIds },
        hasAutoIQ: true,
        autoTradeMode: 'auto-trade',
    }).lean();

    if (followers.length === 0) return [];

    const result: Array<{ follower: IUser; brokerConnection: IBrokerConnection }> = [];
    for (const f of followers as unknown as IUser[]) {
        let brokerConnection: IBrokerConnection | null = null;
        if (f.defaultBrokerConnectionId) {
            brokerConnection = await BrokerConnection.findOne({
                _id: f.defaultBrokerConnectionId,
                whopUserId: f.whopUserId,
                isActive: true,
                brokerType: 'snaptrade',
            });
        }
        if (!brokerConnection) {
            brokerConnection = await BrokerConnection.findOne({
                whopUserId: f.whopUserId,
                isActive: true,
                brokerType: 'snaptrade',
            });
        }
        if (brokerConnection?.accountId && brokerConnection?.authorizationId) {
            result.push({ follower: f, brokerConnection });
        }
    }
    return result;
}

/**
 * Execute follower's broker order only (no DB write). Used for parallel execution with creator.
 * Uses a SHORT wait for execution price (default 10s) so follower trade appears in ~5–10 sec like settle.
 * If broker doesn't return price in time, uses creatorFillPrice so we can persist and notify immediately.
 */
export async function executeFollowerBrokerOrder(
    orderParams: AutoIQOrderParams,
    follower: IUser,
    brokerConnection: IBrokerConnection,
    creatorFillPrice: number
): Promise<FollowerBrokerResult | null> {
    const tempTrade = {
        userId: follower._id,
        whopUserId: follower.whopUserId,
        side: 'BUY' as const,
        contracts: orderParams.contracts,
        ticker: orderParams.ticker,
        strike: orderParams.strike,
        optionType: orderParams.optionType,
        expiryDate: orderParams.expiryDate,
        fillPrice: 0,
        optionContract: orderParams.optionContract,
        refPrice: orderParams.refPrice,
        refTimestamp: orderParams.refTimestamp,
    } as ITrade;

    try {
        const broker = createBroker(brokerConnection.brokerType, brokerConnection);
        const result = await broker.placeOptionOrder(tempTrade, 'BUY', orderParams.contracts);
        if (!result.success || !result.orderId) return null;

        const creatorPrice = Number.isFinite(creatorFillPrice) && creatorFillPrice > 0 ? creatorFillPrice : 0;
        let executionPrice: number | null | undefined = result.executionPrice;
        let executedAt: Date | undefined = result.executedAt ?? undefined;

        // Short wait only (e.g. 10s) so follower sees trade in seconds; fallback to creator price.
        const maxWaitMs = Math.min(
            90000,
            Math.max(3000, parseInt(process.env.AUTOIQ_EXECUTION_PRICE_WAIT_MS || '10000', 10) || 10000)
        );
        if (executionPrice === null || executionPrice === undefined) {
            const polled = await waitForSnapTradeExecutionPrice({
                brokerConnection,
                brokerageOrderId: result.orderId,
                maxWaitMs,
            });
            if (polled) {
                executionPrice = polled.executionPrice;
                executedAt = polled.executedAt ?? executedAt;
            }
        }

        const priceFromBroker = executionPrice !== null && executionPrice !== undefined;
        const num = priceFromBroker
            ? (typeof executionPrice === 'number' ? executionPrice : Number(executionPrice))
            : creatorPrice;
        if (!Number.isFinite(num) || num <= 0) return null;

        return {
            follower,
            brokerConnection,
            executionPrice: num,
            executedAt,
            priceFromBroker: !!priceFromBroker,
            brokerOrderId: result.orderId,
            brokerOrderDetails: (result.orderDetails as Record<string, unknown>) || {},
            brokerCostInfo: result.costInfo ?? {
                grossCost: num * orderParams.contracts * 100,
                commission: 0,
                estimatedFees: {},
                totalCost: num * orderParams.contracts * 100,
            },
        };
    } catch {
        return null;
    }
}

/**
 * Persist follower trades (after creator trade exists) and send Pusher trade.created for each.
 * Caller must have already run broker orders for these followers; play consumption is done in creator transaction.
 */
export async function persistFollowerTradesAndNotify(
    creatorTrade: ITrade,
    creatorUser: IUser,
    results: FollowerBrokerResult[]
): Promise<void> {
    if (!results.length) return;

    // Concurrency matters: sequential DB + Pusher per follower can easily add up to minutes.
    const concurrency = Math.max(1, Math.min(10, parseInt(process.env.AUTOIQ_FOLLOWER_PERSIST_CONCURRENCY || '5', 10) || 5));
    let idx = 0;

    const workers = Array.from({ length: Math.min(concurrency, results.length) }, async () => {
        while (true) {
            const cur = idx++;
            const r = results[cur];
            if (!r) break;

            try {
                // Fast skip if already linked (prevents duplicate trades)
                const existing = await FollowedTradeAction.findOne({
                    followerWhopUserId: r.follower.whopUserId,
                    originalTradeId: creatorTrade._id,
                }).select('_id').lean();
                if (existing) continue;

                const followerTradeData: Partial<ITrade> = {
                    userId: r.follower._id as Types.ObjectId,
                    whopUserId: r.follower.whopUserId,
                    side: 'BUY',
                    contracts: creatorTrade.contracts,
                    ticker: creatorTrade.ticker,
                    strike: creatorTrade.strike,
                    optionType: creatorTrade.optionType,
                    expiryDate: creatorTrade.expiryDate,
                    fillPrice: r.executionPrice,
                    status: 'OPEN',
                    priceVerified: r.priceFromBroker,
                    optionContract: creatorTrade.optionContract,
                    refPrice: creatorTrade.refPrice,
                    refTimestamp: creatorTrade.refTimestamp,
                    remainingOpenContracts: creatorTrade.contracts,
                    totalBuyNotional: creatorTrade.contracts * r.executionPrice * 100,
                    isMarketOrder: true,
                    brokerConnectionId: r.brokerConnection._id as Types.ObjectId,
                    brokerOrderId: r.brokerOrderId,
                    brokerOrderDetails: r.brokerOrderDetails,
                    brokerCostInfo: r.brokerCostInfo,
                    tradeExecutedAt: r.executedAt,
                };

                const followerTrade = new Trade(followerTradeData);
                await followerTrade.save();

                // Create the FollowedTradeAction FIRST so that a refetch triggered by Pusher
                // immediately returns `isFollowedTrade: true` and doesn't flash Settle/Delete.
                const upsertRes = await FollowedTradeAction.updateOne(
                    {
                        followerWhopUserId: r.follower.whopUserId,
                        originalTradeId: creatorTrade._id,
                    },
                    {
                        $setOnInsert: {
                            followerUserId: r.follower._id,
                            followerWhopUserId: r.follower.whopUserId,
                            originalTradeId: creatorTrade._id,
                            action: 'follow',
                            followedTradeId: followerTrade._id,
                        },
                    },
                    { upsert: true }
                );

                // If it already existed (race/duplicate), delete the new trade and skip notifying.
                // upsertedCount is available in modern drivers; fall back to checking upsertedId shape.
                const inserted = (upsertRes as unknown as { upsertedCount?: number; upsertedId?: unknown }).upsertedCount
                    ? (upsertRes as unknown as { upsertedCount: number }).upsertedCount > 0
                    : Boolean((upsertRes as unknown as { upsertedId?: unknown }).upsertedId);

                if (!inserted) {
                    await Trade.deleteOne({ _id: followerTrade._id }).catch(() => undefined);
                    continue;
                }

                // Follower's trade page: push only after trade + link are stored.
                try {
                    await triggerUserEvent(r.follower.whopUserId, 'trade.created', {
                        type: 'autoiq.trade.created',
                        tradeId: String(followerTrade._id),
                        originalTradeId: String(creatorTrade._id),
                        creatorWhopUserId: creatorUser.whopUserId,
                        createdAt: followerTrade.createdAt,
                    });
                } catch {
                    // ignore
                }
            } catch (e) {
                console.error('[AutoIQ] persistFollowerTradesAndNotify failed', {
                    followerWhopUserId: r.follower?.whopUserId,
                    originalTradeId: String(creatorTrade._id),
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
    });

    await Promise.all(workers);
}

/**
 * Automatically create and execute trades for followers with AutoIQ enabled
 * when a creator creates a new trade.
 * @deprecated Use parallel flow from POST /api/trades (creator + follower broker orders in parallel).
 */
export async function autoTradeForFollowers(
    creatorTrade: ITrade,
    creatorUser: IUser
): Promise<void> {
    if (!creatorUser || !creatorUser.whopUserId) {
        return;
    }

    try {
        // Find all active follow purchases for this creator
        const activeFollows = await FollowPurchase.find({
            capperWhopUserId: creatorUser.whopUserId,
            status: 'active',
            $expr: { $lt: ['$numPlaysConsumed', '$numPlaysPurchased'] },
        }).lean();

        if (activeFollows.length === 0) {
            return;
        }

        // Get unique follower Whop user IDs
        const followerWhopUserIds = [...new Set(activeFollows.map(f => f.followerWhopUserId))];

        // Find all follower users who have AutoIQ enabled with auto-trade mode
        const followers = await User.find({
            whopUserId: { $in: followerWhopUserIds },
            hasAutoIQ: true,
            autoTradeMode: 'auto-trade',
        }).lean();

        if (followers.length === 0) {
            return;
        }

        // Process each follower's auto-trade in parallel.
        // We await so that Pusher trade.created for each follower is sent before the API response.
        const autoTradePromises = followers.map(async (follower) => {
            try {
                await autoTradeForSingleFollower(creatorTrade, creatorUser, follower as unknown as IUser, activeFollows as unknown as IFollowPurchase[]);
            } catch {
                // Silent fail - don't break creator's trade creation
            }
        });

        await Promise.allSettled(autoTradePromises);
    } catch {
        // Silent fail - don't break creator's trade creation
    }
}

/**
 * Automatically create and execute a trade for a single follower
 */
async function autoTradeForSingleFollower(
    creatorTrade: ITrade,
    creatorUser: IUser,
    follower: IUser,
    activeFollows: IFollowPurchase[]
): Promise<void> {
    // Check if follower has an active follow for this creator
    const followerFollow = activeFollows.find(
        (f) => f.followerWhopUserId === follower.whopUserId
    );

    if (!followerFollow) {
        return; // Follower doesn't have an active follow
    }

    // Check if follower already followed this trade (prevent duplicates)
    const existingAction = await FollowedTradeAction.findOne({
        followerWhopUserId: follower.whopUserId,
        originalTradeId: creatorTrade._id,
        action: 'follow',
    });

    if (existingAction) {
        return; // Already followed this trade
    }

    // Get follower's default broker connection
    let brokerConnection: IBrokerConnection | null = null;

    if (follower.defaultBrokerConnectionId) {
        brokerConnection = await BrokerConnection.findOne({
            _id: follower.defaultBrokerConnectionId,
            whopUserId: follower.whopUserId,
            isActive: true,
            brokerType: 'snaptrade',
        });
    }

    // If no default broker or default broker not found, try to find any active broker
    if (!brokerConnection) {
        brokerConnection = await BrokerConnection.findOne({
            whopUserId: follower.whopUserId,
            isActive: true,
            brokerType: 'snaptrade',
        });
    }

    // If still no broker connection, skip auto-trade (follower needs to connect a broker)
    if (!brokerConnection) {
        return;
    }

    // Validate broker connection has required fields for placing orders
    if (!brokerConnection.accountId || !brokerConnection.authorizationId) {
        return;
    }

    // Validate trade constraints (same as manual follow)
    // Only single-leg options
    if (creatorTrade.optionType !== 'C' && creatorTrade.optionType !== 'P') {
        return; // Not a single-leg option
    }

    // Use creator's fill price (already executed by broker)
    // The broker will determine the actual execution price when placing the follower's order
    const fillPrice = creatorTrade.fillPrice;

    // Create the follower's trade
    const followerTradeData: Partial<ITrade> = {
        userId: follower._id as Types.ObjectId,
        whopUserId: follower.whopUserId,
        side: 'BUY',
        contracts: creatorTrade.contracts, // Default: same number of contracts (can be customized later with risk settings)
        ticker: creatorTrade.ticker,
        strike: creatorTrade.strike,
        optionType: creatorTrade.optionType,
        expiryDate: creatorTrade.expiryDate,
        fillPrice: fillPrice,
        status: 'OPEN',
        priceVerified: true,
        optionContract: creatorTrade.optionContract,
        refPrice: creatorTrade.refPrice,
        refTimestamp: creatorTrade.refTimestamp,
        remainingOpenContracts: creatorTrade.contracts,
        totalBuyNotional: creatorTrade.contracts * fillPrice * 100,
        isMarketOrder: creatorTrade.isMarketOrder ?? true,
        brokerConnectionId: brokerConnection._id as Types.ObjectId,
    };

    // Execute the trade on the follower's broker account FIRST
    // Only create the trade in database if broker order succeeds
    let brokerOrderId: string | undefined;
    let brokerOrderDetails: Record<string, unknown> | undefined;
    let brokerCostInfo: {
        grossCost: number;
        commission: number;
        estimatedFees: Record<string, number>;
        totalCost: number;
    } | undefined;

    try {
        const broker = createBroker(brokerConnection.brokerType, brokerConnection);
        const result = await broker.placeOptionOrder(
            followerTradeData as ITrade,
            'BUY',
            followerTradeData.contracts!
        );

        if (!result.success) {
            // Broker execution failed - DO NOT create the trade
            return; // Exit without creating trade
        }

        // Broker order succeeded - store the results
        brokerOrderId = result.orderId;
        brokerOrderDetails = result.orderDetails as Record<string, unknown>;
        brokerCostInfo = result.costInfo;

        // IMPORTANT: Match creator behavior — DO NOT persist until execution price is confirmed.
        let executionPrice: number | null | undefined = result.executionPrice;
        let executedAt: Date | undefined = result.executedAt || undefined;

        // If the broker did not return execution price yet, wait longer and confirm via order detail.
        if (executionPrice === null || executionPrice === undefined) {
            const maxWaitMs = 90000; // 90s
            if (brokerOrderId) {
                const polled = await waitForSnapTradeExecutionPrice({
                    brokerConnection,
                    brokerageOrderId: brokerOrderId,
                    maxWaitMs,
                });
                if (polled) {
                    executionPrice = polled.executionPrice;
                    executedAt = polled.executedAt || executedAt;
                }
            }
        }

        // If still no confirmed execution price, do NOT create the follower trade.
        if (executionPrice === null || executionPrice === undefined) {
            return;
        }
        const executionPriceNum = typeof executionPrice === 'number' ? executionPrice : Number(executionPrice);
        if (!Number.isFinite(executionPriceNum) || executionPriceNum <= 0) {
            return;
        }

        followerTradeData.fillPrice = executionPriceNum;
        followerTradeData.totalBuyNotional = followerTradeData.contracts! * executionPriceNum * 100;

        // Use follower's own broker execution time (when their order was filled)
        if (executedAt) {
            followerTradeData.tradeExecutedAt = executedAt;
        }
    } catch {
        // Broker execution failed - DO NOT create the trade
        return; // Exit without creating trade
    }

    // Only reach here if broker order succeeded
    // Add broker info to trade data
    followerTradeData.brokerOrderId = brokerOrderId!;
    if (brokerOrderDetails) {
        followerTradeData.brokerOrderDetails = brokerOrderDetails;
    }
    if (brokerCostInfo) {
        followerTradeData.brokerCostInfo = brokerCostInfo;
    }

    // Create the follower's trade in database (only after successful broker order)
    const followerTrade = new Trade(followerTradeData);
    await followerTrade.save();

    // Follower's trade page: push only after this follower's trade is created and stored (see save() above).
    try {
        await triggerUserEvent(follower.whopUserId, 'trade.created', {
            type: 'autoiq.trade.created',
            tradeId: String(followerTrade._id),
            originalTradeId: String(creatorTrade._id),
            creatorWhopUserId: creatorUser.whopUserId,
            createdAt: followerTrade.createdAt,
        });
    } catch {
        // Don't fail the follow if Pusher fails
    }

    // Create the FollowedTradeAction record to link follower trade to creator trade
    const followedTradeAction = new FollowedTradeAction({
        followerUserId: follower._id,
        followerWhopUserId: follower.whopUserId,
        originalTradeId: creatorTrade._id,
        action: 'follow',
        followedTradeId: followerTrade._id,
    });

    await followedTradeAction.save();
}

/**
 * Automatically settle follower trades when a creator settles their trade
 */
export async function autoSettleForFollowers(
    creatorTrade: ITrade,
    fillContracts: number,
    fillPrice: number
): Promise<void> {
    try {
        // Find all follower trades linked to this creator trade
        const followedActions = await FollowedTradeAction.find({
            originalTradeId: creatorTrade._id,
            action: 'follow',
        }).lean();

        if (followedActions.length === 0) {
            return;
        }

        // Get all follower trade IDs
        const followerTradeIds = followedActions
            .map((action) => action.followedTradeId)
            .filter((id): id is Types.ObjectId => id !== undefined);

        if (followerTradeIds.length === 0) {
            return;
        }

        // Find all follower trades that are still OPEN
        const followerTrades = await Trade.find({
            _id: { $in: followerTradeIds },
            status: 'OPEN',
            side: 'BUY',
        }).lean();

        if (followerTrades.length === 0) {
            return;
        }

        // Get unique follower user IDs
        const followerUserIds = [...new Set(followerTrades.map((t) => t.whopUserId))];

        // Find all follower users who have AutoIQ enabled with auto-trade mode
        const followers = await User.find({
            whopUserId: { $in: followerUserIds },
            hasAutoIQ: true,
            autoTradeMode: 'auto-trade',
        }).lean();

        // Create a map of follower whopUserId to follower user object
        const followerMap = new Map<string, typeof followers[0]>();
        for (const follower of followers) {
            if (follower.whopUserId) {
                followerMap.set(follower.whopUserId, follower);
            }
        }

        // Process each follower's auto-settlement in parallel; await so caller (settle route) completes before response.
        const autoSettlePromises = followerTrades.map(async (followerTrade) => {
            try {
                const follower = followerMap.get(followerTrade.whopUserId);
                if (!follower) {
                    return; // Follower doesn't have AutoIQ enabled anymore
                }

                await autoSettleForSingleFollower(followerTrade as unknown as ITrade, fillContracts, fillPrice, follower as unknown as IUser);
            } catch {
                // Silent fail - don't break creator's trade settlement
            }
        });

        await Promise.allSettled(autoSettlePromises);
    } catch (e) {
        // Don't break creator's settlement; log for debugging.
        console.error('[AutoIQ] autoSettleForFollowers error:', e);
    }
}

/**
 * Automatically settle a single follower's trade
 */
async function autoSettleForSingleFollower(
    followerTrade: ITrade,
    fillContracts: number,
    fillPrice: number,
    follower: IUser
): Promise<void> {
    // Determine how many contracts to settle (same as creator, but respect follower's remaining contracts)
    const contractsToSettle = Math.min(fillContracts, followerTrade.remainingOpenContracts || followerTrade.contracts);

    if (contractsToSettle <= 0) {
        return; // No contracts to settle
    }

    // Get follower's broker connection (same one used to create the trade)
    let brokerConnection: IBrokerConnection | null = null;

    if (followerTrade.brokerConnectionId) {
        brokerConnection = await BrokerConnection.findOne({
            _id: followerTrade.brokerConnectionId,
            whopUserId: follower.whopUserId,
            isActive: true,
            brokerType: 'snaptrade',
        });
    }

    // If broker connection not found, try default broker
    if (!brokerConnection && follower.defaultBrokerConnectionId) {
        brokerConnection = await BrokerConnection.findOne({
            _id: follower.defaultBrokerConnectionId,
            whopUserId: follower.whopUserId,
            isActive: true,
            brokerType: 'snaptrade',
        });
    }

    // If still no broker connection, skip auto-settle (follower needs to manually settle)
    if (!brokerConnection) {
        return;
    }

    // Validate broker connection has required fields for placing orders
    if (!brokerConnection.accountId || !brokerConnection.authorizationId) {
        return;
    }

    // Execute the sell order on the follower's broker account FIRST
    // Only create the settlement record if broker order succeeds
    let actualFillPrice = fillPrice; // Default to creator's fill price
    let fillExecutedAt: Date | undefined;
    try {
        const broker = createBroker(brokerConnection.brokerType, brokerConnection);
        const result = await broker.placeOptionOrder(
            followerTrade,
            'SELL',
            contractsToSettle,
            fillPrice // Use the same fill price as creator
        );

        if (!result.success) {
            // Broker execution failed - DO NOT create the settlement record
            return;
        }

        // Match creator behavior — wait for confirmed execution price before persisting settlement.
        let executionPrice: number | null | undefined = result.executionPrice;
        let executedAt: Date | undefined = result.executedAt || undefined;

        if (executionPrice === null || executionPrice === undefined) {
            const maxWaitMs = parseInt(process.env.AUTOIQ_EXECUTION_PRICE_TIMEOUT_MS || '90000', 10);
            if (result.orderId) {
                const polled = await waitForSnapTradeExecutionPrice({
                    brokerConnection,
                    brokerageOrderId: result.orderId,
                    maxWaitMs,
                });
                if (polled) {
                    executionPrice = polled.executionPrice;
                    executedAt = polled.executedAt || executedAt;
                }
            }
        }

        if (executionPrice === null || executionPrice === undefined) {
            return;
        }
        const executionPriceNum = typeof executionPrice === 'number' ? executionPrice : Number(executionPrice);
        if (!Number.isFinite(executionPriceNum) || executionPriceNum <= 0) {
            return;
        }

        actualFillPrice = executionPriceNum;
        fillExecutedAt = executedAt;
    } catch {
        // Broker execution failed - DO NOT create the settlement record
        return;
    }

    // Only reach here if broker order succeeded
    // Create the settlement record in database using a transaction (same logic as manual settlement)
    const mongoose = await import('mongoose');
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { TradeFill } = await import('@/models/TradeFill');

        const sellNotional = contractsToSettle * actualFillPrice * 100;

        // Create SELL fill within transaction
        await TradeFill.create([{
            tradeId: followerTrade._id,
            side: 'SELL',
            contracts: contractsToSettle,
            fillPrice: actualFillPrice, // Use actual broker execution price
            priceVerified: true,
            notional: sellNotional,
            isMarketOrder: true,
            ...(fillExecutedAt && { fillExecutedAt }),
        }], { session });

        // Get all SELL fills for this trade to calculate totals (within transaction)
        const allFills = await TradeFill.find({ tradeId: followerTrade._id }).session(session).lean();
        const totalSellNotional = allFills.reduce((sum, f) => sum + (f.notional || 0), 0);
        const totalBuyNotional = followerTrade.totalBuyNotional || 0;
        const netPnl = totalSellNotional - totalBuyNotional;

        // Calculate remaining open contracts
        const totalSoldContracts = allFills.reduce((sum, f) => sum + f.contracts, 0);
        const remainingOpenContracts = followerTrade.contracts - totalSoldContracts;

        // Update trade status within transaction
        await Trade.findByIdAndUpdate(
            followerTrade._id,
            {
                $inc: { remainingOpenContracts: -contractsToSettle },
                $set: {
                    totalSellNotional: totalSellNotional,
                    netPnl: netPnl,
                    status: remainingOpenContracts <= 0 ? 'CLOSED' : 'OPEN',
                    outcome: netPnl > 0 ? 'WIN' : netPnl < 0 ? 'LOSS' : 'BREAKEVEN',
                },
            },
            { session }
        );

        // Commit transaction
        await session.commitTransaction();

        // Follower's trade page: push only after this follower's trade is updated and stored (see commit above).
        try {
            await triggerUserEvent(follower.whopUserId, 'trade.updated', {
                type: 'autoiq.trade.settled',
                tradeId: String(followerTrade._id),
            });
        } catch {
            // Don't fail settlement if Pusher fails
        }
    } catch (error) {
        // Rollback transaction on error
        await session.abortTransaction();
        throw error;
    } finally {
        await session.endSession();
    }
}

