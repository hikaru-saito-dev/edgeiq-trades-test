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

/**
 * Automatically create and execute trades for followers with AutoIQ enabled
 * when a creator creates a new trade.
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

        // Process each follower's auto-trade (fire and forget - don't block creator's trade creation)
        const autoTradePromises = followers.map(async (follower) => {
            try {
                await autoTradeForSingleFollower(creatorTrade, creatorUser, follower as unknown as IUser, activeFollows as unknown as IFollowPurchase[]);
            } catch {
                // Silent fail - don't break creator's trade creation
            }
        });

        // Execute all auto-trades in parallel (fire and forget)
        Promise.allSettled(autoTradePromises);
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

        // Use creator's tradeExecutedAt if available (for accurate timestamp)
        // Otherwise use the follower's broker execution timestamp
        if (creatorTrade.tradeExecutedAt) {
            followerTradeData.tradeExecutedAt = creatorTrade.tradeExecutedAt;
        } else if (executedAt) {
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

        // Process each follower's auto-settlement (fire and forget)
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

        // Execute all auto-settlements in parallel (fire and forget)
        Promise.allSettled(autoSettlePromises);
    } catch {
        // Silent fail - don't break creator's trade settlement
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
    } catch (error) {
        // Rollback transaction on error
        await session.abortTransaction();
        throw error;
    } finally {
        await session.endSession();
    }
}

