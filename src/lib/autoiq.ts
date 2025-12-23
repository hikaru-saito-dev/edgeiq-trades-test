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
import { getMarketFillPrice } from '@/lib/polygon';

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
            } catch (error) {
                // Log error but don't fail the entire operation
                console.error(`Error auto-trading for follower ${follower.whopUserId}:`, error);
            }
        });

        // Execute all auto-trades in parallel (fire and forget)
        Promise.allSettled(autoTradePromises).catch((err) => {
            console.error('Error in auto-trade batch:', err);
        });
    } catch (error) {
        // Silent fail - don't break creator's trade creation
        console.error('Error in autoTradeForFollowers:', error);
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
        console.log(`Skipping auto-trade for follower ${follower.whopUserId}: No broker connection`);
        return;
    }

    // Validate trade constraints (same as manual follow)
    // Only single-leg options
    if (creatorTrade.optionType !== 'C' && creatorTrade.optionType !== 'P') {
        return; // Not a single-leg option
    }

    // Get market fill price for the follower's trade
    let fillPrice = creatorTrade.fillPrice;
    try {
        const { getOptionContractSnapshot, formatExpiryDateForAPI } = await import('@/lib/polygon');
        // Format expiry date from Date to MM/DD/YYYY string, then to YYYY-MM-DD
        const expiryDate = creatorTrade.expiryDate instanceof Date
            ? creatorTrade.expiryDate
            : new Date(creatorTrade.expiryDate);
        const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
        const day = String(expiryDate.getDate()).padStart(2, '0');
        const year = expiryDate.getFullYear();
        const expiryDateStr = `${month}/${day}/${year}`;
        const expiryDateAPI = formatExpiryDateForAPI(expiryDateStr);
        const contractType = creatorTrade.optionType === 'C' ? 'call' : 'put';
        const { snapshot, error: snapshotError } = await getOptionContractSnapshot(
            creatorTrade.ticker,
            creatorTrade.strike,
            expiryDateAPI,
            contractType
        );
        if (snapshot && !snapshotError) {
            const marketPrice = getMarketFillPrice(snapshot);
            if (marketPrice) {
                fillPrice = marketPrice;
            }
        }
    } catch (error) {
        // If market price fetch fails, use creator's fill price
        console.error('Error fetching market price for auto-trade:', error);
    }

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

    // Execute the trade on the follower's broker account
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
            // Broker execution failed - still create the trade record but mark it as failed
            console.error(`Broker execution failed for follower ${follower.whopUserId}:`, result.error);
            brokerOrderId = 'unknown';
        } else {
            brokerOrderId = result.orderId;
            brokerOrderDetails = result.orderDetails as Record<string, unknown>;
            brokerCostInfo = result.costInfo;
        }
    } catch (brokerError) {
        // Broker execution failed - still create the trade record but mark it as failed
        console.error(`Broker execution error for follower ${follower.whopUserId}:`, brokerError);
        brokerOrderId = 'unknown';
    }

    // Add broker info to trade data
    if (brokerOrderId) {
        followerTradeData.brokerOrderId = brokerOrderId;
        if (brokerOrderDetails) {
            followerTradeData.brokerOrderDetails = brokerOrderDetails;
        }
        if (brokerCostInfo) {
            followerTradeData.brokerCostInfo = brokerCostInfo;
        }
    }

    // Create the follower's trade in database
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
            } catch (error) {
                // Log error but don't fail the entire operation
                console.error(`Error auto-settling for follower trade ${followerTrade._id}:`, error);
            }
        });

        // Execute all auto-settlements in parallel (fire and forget)
        Promise.allSettled(autoSettlePromises).catch((err) => {
            console.error('Error in auto-settle batch:', err);
        });
    } catch (error) {
        // Silent fail - don't break creator's trade settlement
        console.error('Error in autoSettleForFollowers:', error);
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
        console.log(`Skipping auto-settle for follower trade ${followerTrade._id}: No broker connection`);
        return;
    }

    // Execute the sell order on the follower's broker account
    try {
        const broker = createBroker(brokerConnection.brokerType, brokerConnection);
        const result = await broker.placeOptionOrder(
            followerTrade,
            'SELL',
            contractsToSettle,
            fillPrice // Use the same fill price as creator
        );

        if (!result.success) {
            // Broker execution failed - still create the settlement record but mark it as failed
            console.error(`Broker settlement failed for follower trade ${followerTrade._id}:`, result.error);
        }
    } catch (brokerError) {
        // Broker execution failed - still create the settlement record but mark it as failed
        console.error(`Broker settlement error for follower trade ${followerTrade._id}:`, brokerError);
    }

    // Create the settlement record in database (using the same logic as manual settlement)
    // Note: This should use the same transaction logic as /api/trades/settle
    // For now, we'll create the fill directly (simplified version)
    const { TradeFill } = await import('@/models/TradeFill');

    const sellNotional = contractsToSettle * fillPrice * 100;

    await TradeFill.create([{
        tradeId: followerTrade._id,
        side: 'SELL',
        contracts: contractsToSettle,
        fillPrice: fillPrice,
        priceVerified: true,
        notional: sellNotional,
        isMarketOrder: true,
    }]);

    // Update the follower's trade status
    const allFills = await TradeFill.find({ tradeId: followerTrade._id }).lean();
    const totalSellNotional = allFills.reduce((sum, f) => sum + (f.notional || 0), 0);
    const totalBuyNotional = followerTrade.totalBuyNotional || 0;
    const netPnl = totalSellNotional - totalBuyNotional;

    // Calculate remaining open contracts
    const totalSoldContracts = allFills.reduce((sum, f) => sum + f.contracts, 0);
    const remainingOpenContracts = followerTrade.contracts - totalSoldContracts;

    // Update trade status
    await Trade.findByIdAndUpdate(followerTrade._id, {
        $inc: { remainingOpenContracts: -contractsToSettle },
        $set: {
            totalSellNotional: totalSellNotional,
            netPnl: netPnl,
            status: remainingOpenContracts <= 0 ? 'CLOSED' : 'OPEN',
            outcome: netPnl > 0 ? 'WIN' : netPnl < 0 ? 'LOSS' : 'BREAKEVEN',
        },
    });
}

