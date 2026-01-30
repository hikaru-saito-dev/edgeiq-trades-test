import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import mongoose from 'mongoose';
import { Trade, ITrade } from '@/models/Trade';
import { TradeFill } from '@/models/TradeFill';
import { Log } from '@/models/Log';
import { createTradeSchema, parseExpiryDate } from '@/utils/tradeValidation';
import { isMarketOpen } from '@/utils/marketHours';
// Removed Massive.com API - only using broker execution_price
import { notifyTradeCreated, notifyTradeDeleted } from '@/lib/tradeNotifications';
import { z } from 'zod';
import { PipelineStage } from 'mongoose';
import { SlidingWindowRateLimiter } from '@/lib/rateLimit';
import { recordApiMetric } from '@/lib/metrics';
import { Types } from 'mongoose';
import { performance } from 'node:perf_hooks';
import {
  invalidateCompanyStatsCache,
  invalidateLeaderboardCache,
  invalidatePersonalStatsCache,
} from '@/lib/cache/statsCache';
import { FollowPurchase } from '@/models/FollowPurchase';
import { triggerUserEvent, triggerUsersEvent } from '@/lib/realtime/pusherServer';
import {
  getEligibleAutoIQFollowersWithBrokers,
  executeFollowerBrokerOrder,
  persistFollowerTradesAndNotify,
  type AutoIQOrderParams,
  type FollowerBrokerResult,
} from '@/lib/autoiq';

export const runtime = 'nodejs';

const tradeWriteLimiter = new SlidingWindowRateLimiter(60, 60_000);

/**
 * GET /api/trades
 * Get trades for the authenticated user with pagination and filtering
 */
export async function GET(request: NextRequest) {
  const startTime = performance.now();
  const metricMeta: Record<string, unknown> = { status: 'success' };
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      metricMeta.status = 'unauthorized';
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find user with company membership
    const { getUserForCompany } = await import('@/lib/userHelpers');
    if (!companyId) {
      metricMeta.status = 'user_not_found';
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }
    const userResult = await getUserForCompany(userId, companyId);
    if (!userResult || !userResult.membership) {
      metricMeta.status = 'user_not_found';
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { user } = userResult;

    // All roles (companyOwner, owner, admin, member) can only view their OWN trades
    // The "My Trades" page shows personal trades only, not all company trades (matching betting-whop pattern)

    // Parse query params
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10)));
    const search = (searchParams.get('search') || '').trim();
    const status = searchParams.get('status')?.trim();

    // Build match query - ALL users see only their own trades (by whopUserId for cross-company)
    const matchQuery: Record<string, unknown> = {
      whopUserId: user.whopUserId, // Person-level, works across all companies
      side: 'BUY', // Only get BUY trades (the main trade entries)
    };

    // Filter by status if provided
    if (status && ['OPEN', 'CLOSED', 'REJECTED'].includes(status)) {
      matchQuery.status = status;
    }

    // Search by ticker
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      matchQuery.ticker = regex;
    }


    const skip = (page - 1) * pageSize;
    const tradeFillCollection = TradeFill.collection.name;
    const { FollowedTradeAction } = await import('@/models/FollowedTradeAction');
    const followedTradeActionCollection = FollowedTradeAction.collection.name;

    const pipeline: PipelineStage[] = [
      { $match: matchQuery },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: pageSize },
            {
              $lookup: {
                from: tradeFillCollection,
                let: { tradeId: '$_id' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$tradeId', '$$tradeId'] } } },
                  { $sort: { createdAt: -1 } },
                ],
                as: 'fills',
              },
            },
            {
              $lookup: {
                from: followedTradeActionCollection,
                let: { tradeId: '$_id' },
                pipeline: [
                  { $match: { $expr: { $eq: [{ $toString: '$followedTradeId' }, { $toString: '$$tradeId' }] } } },
                  { $limit: 1 },
                ],
                as: 'followedTradeAction',
              },
            },
            {
              $addFields: {
                isFollowedTrade: { $gt: [{ $size: '$followedTradeAction' }, 0] },
              },
            },
            {
              $project: {
                followedTradeAction: 0, // Remove the lookup result, keep only the flag
              },
            },
          ],
          totalCount: [
            { $count: 'count' },
          ],
        },
      },
      {
        $project: {
          trades: '$data',
          total: {
            $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0],
          },
        },
      },
    ];

    const aggregated = await Trade.aggregate(pipeline).allowDiskUse(true);
    const aggregationResult = aggregated[0] || { trades: [], total: 0 };

    const responsePayload = {
      trades: aggregationResult.trades,
      page,
      pageSize,
      total: aggregationResult.total,
      totalPages: Math.ceil((aggregationResult.total || 0) / pageSize),
    };

    metricMeta.total = aggregationResult.total || 0;

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching trades:', error);
    metricMeta.status = 'error';
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    metricMeta.total = metricMeta.total ?? 0;
    recordApiMetric('trades#get', {
      durationMs: Math.round(performance.now() - startTime),
      cacheHit: false,
      meta: metricMeta,
    });
  }
}

/**
 * POST /api/trades
 * Create a new BUY trade (OPEN)
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let metricMeta: Record<string, unknown> = { status: 'success' };
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      metricMeta = { status: 'unauthorized' };
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find user with company membership
    const { getUserForCompany } = await import('@/lib/userHelpers');
    if (!companyId) {
      metricMeta = { status: 'user_not_found' };
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }
    const userResult = await getUserForCompany(userId, companyId);
    if (!userResult || !userResult.membership) {
      metricMeta = { status: 'user_not_found' };
      return NextResponse.json({ error: 'User not found. Please set up your profile first.' }, { status: 404 });
    }
    const { user, membership } = userResult;

    // Allow all roles (companyOwner, owner, admin, member) to create trades
    const limitResult = tradeWriteLimiter.tryConsume(userId);
    if (!limitResult.allowed) {
      metricMeta = { status: 'rate_limited' };
      return NextResponse.json(
        { error: 'Too many trade actions. Please slow down.' },
        {
          status: 429,
          headers: limitResult.retryAfterSeconds
            ? { 'Retry-After': String(limitResult.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    // CompanyId is only used for user lookup, not stored on trades

    // Check market hours
    const now = new Date();
    if (!isMarketOpen(now)) {
      return NextResponse.json({
        error: 'Market is closed. Trades can only be created/settled between 09:30–16:00 EST.',
      }, { status: 400 });
    }

    const body = await request.json();

    // Validate request data
    let validated;
    try {
      validated = createTradeSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        metricMeta = { status: 'validation_error' };
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        );
      }
      metricMeta = { status: 'invalid_request' };
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    // Parse expiry date
    const expiryDate = parseExpiryDate(validated.expiryDate);

    // Removed Massive.com API - only using broker execution_price
    // If broker doesn't provide execution_price, trade will be rejected
    // We'll set finalFillPrice from broker execution_price after broker order is placed
    let finalFillPrice = 0; // Will be set from broker execution_price
    const optionContractTicker = undefined; // Not needed without Massive.com
    const referencePrice = undefined; // Not needed without Massive.com
    const refTimestamp = new Date();

    // Calculate notional - will be recalculated with broker execution_price
    let notional = 0; // Will be set from broker execution_price

    // Normalize selectedWebhookIds if provided
    // If selectedWebhookIds is provided (even if empty array), validate and use it
    // If undefined, don't set it on the trade (for backward compatibility)
    let normalizedSelectedWebhookIds: string[] | undefined = undefined;
    if (validated.selectedWebhookIds !== undefined) {
      if (validated.selectedWebhookIds.length > 0) {
        // Validate that webhook IDs exist in user's webhooks for this company
        const userWebhooks = membership.webhooks || [];
        normalizedSelectedWebhookIds = validated.selectedWebhookIds.filter((id: string) => {
          return userWebhooks.some((webhook: { id: string; name: string; url: string; type: 'whop' | 'discord' }) => webhook.id === id);
        });
      } else {
        // Empty array means explicitly no webhooks selected
        normalizedSelectedWebhookIds = [];
      }
    }

    // Find active SnapTrade broker connection for creator
    const { BrokerConnection } = await import('@/models/BrokerConnection');
    const { getActiveBrokerCacheByUserId, setActiveBrokerCacheByUserId } = await import('@/lib/cache/brokerCache');
    const userIdStr = String(user._id);
    let brokerConnection = getActiveBrokerCacheByUserId(userIdStr);
    if (!brokerConnection) {
      if (validated.brokerConnectionId) {
        brokerConnection = await BrokerConnection.findOne({
          _id: validated.brokerConnectionId,
          userId: user._id as Types.ObjectId,
          brokerType: 'snaptrade',
          isActive: true,
        });
      } else {
        brokerConnection = await BrokerConnection.findOne({
          userId: user._id as Types.ObjectId,
          brokerType: 'snaptrade',
          isActive: true,
        });
      }
      setActiveBrokerCacheByUserId(userIdStr, brokerConnection ?? null);
    }
    if (!brokerConnection) {
      return NextResponse.json({
        error: 'No active broker connection found. Please connect a broker account first.',
      }, { status: 400 });
    }

    // Creator only: run creator broker order (creator waits only for their own trade)
    const creatorBrokerPromise = (async () => {
      const tempTrade = {
        ticker: validated.ticker,
        strike: validated.strike,
        optionType: validated.optionType,
        expiryDate,
        contracts: validated.contracts,
        fillPrice: finalFillPrice,
      } as ITrade;
      const { createBroker } = await import('@/lib/brokers/factory');
      const broker = createBroker(brokerConnection!.brokerType, brokerConnection!);
      const result = await broker.placeOptionOrder(tempTrade, 'BUY', validated.contracts);
      if (!result.success) {
        return { success: false as const, error: result.error || 'Failed to place order with broker' };
      }
      let fillPrice = finalFillPrice;
      let notionalVal = notional;
      let executionPriceTimedOut = Boolean(result.executionPriceTimedOut);
      let brokerExecutionPriceVal: number | null | undefined = result.executionPrice;
      if (brokerExecutionPriceVal !== null && brokerExecutionPriceVal !== undefined) {
        const num = typeof brokerExecutionPriceVal === 'number' ? brokerExecutionPriceVal : Number(brokerExecutionPriceVal);
        if (Number.isFinite(num) && num > 0) {
          fillPrice = num;
          notionalVal = validated.contracts * fillPrice * 100;
          executionPriceTimedOut = false;
        } else {
          executionPriceTimedOut = true;
          brokerExecutionPriceVal = null;
        }
      } else {
        executionPriceTimedOut = true;
      }
      return {
        success: true as const,
        brokerType: brokerConnection!.brokerType,
        brokerOrderId: result.orderId!,
        brokerConnectionId: brokerConnection!._id as Types.ObjectId,
        brokerOrderDetails: result.orderDetails,
        brokerCostInfo: result.costInfo,
        brokerExecutionPrice: brokerExecutionPriceVal,
        tradeExecutedAt: result.executedAt,
        brokerExecutionPriceTimedOut: executionPriceTimedOut,
        finalFillPrice: fillPrice,
        notional: notionalVal,
        priceSource: result.priceSource || 'broker',
      };
    })().catch((err) => ({
      success: false as const,
      error: err instanceof Error ? err.message : 'Failed to place order with broker',
    }));

    const creatorResult = await creatorBrokerPromise;

    if (!creatorResult.success) {
      return NextResponse.json({
        error: creatorResult.error,
      }, { status: 400 });
    }

    const brokerType = creatorResult.brokerType;
    const brokerOrderId = creatorResult.brokerOrderId;
    const brokerConnectionId = creatorResult.brokerConnectionId;
    const brokerOrderDetails = creatorResult.brokerOrderDetails;
    const brokerCostInfo = creatorResult.brokerCostInfo;
    const brokerExecutionPrice = creatorResult.brokerExecutionPrice;
    const tradeExecutedAt = creatorResult.tradeExecutedAt;
    const brokerExecutionPriceTimedOut = creatorResult.brokerExecutionPriceTimedOut;
    finalFillPrice = creatorResult.finalFillPrice;
    notional = creatorResult.notional;
    const priceSource = creatorResult.priceSource;

    // Start database session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create trade within transaction
      const trade = await Trade.create([{
        userId: user._id as Types.ObjectId,
        whopUserId: user.whopUserId,
        side: 'BUY',
        contracts: validated.contracts,
        ticker: validated.ticker,
        strike: validated.strike,
        optionType: validated.optionType,
        expiryDate: expiryDate,
        fillPrice: finalFillPrice,
        // If we couldn't obtain an execution_price from the broker, reject so it won't count in stats.
        status: (brokerExecutionPriceTimedOut || brokerExecutionPrice === null || brokerExecutionPrice === undefined) ? 'REJECTED' : 'OPEN',
        priceVerified: (brokerExecutionPriceTimedOut || brokerExecutionPrice === null || brokerExecutionPrice === undefined) ? false : true,
        optionContract: optionContractTicker || undefined,
        refPrice: referencePrice || undefined,
        refTimestamp,
        remainingOpenContracts: (brokerExecutionPriceTimedOut || brokerExecutionPrice === null || brokerExecutionPrice === undefined) ? 0 : validated.contracts,
        totalBuyNotional: (brokerExecutionPriceTimedOut || brokerExecutionPrice === null || brokerExecutionPrice === undefined) ? 0 : notional,
        isMarketOrder: true, // Always market orders
        ...(normalizedSelectedWebhookIds !== undefined && { selectedWebhookIds: normalizedSelectedWebhookIds }),
        ...(brokerType && { brokerType }),
        ...(brokerOrderId && { brokerOrderId }),
        ...(brokerConnectionId && { brokerConnectionId }),
        ...(brokerOrderDetails && { brokerOrderDetails }),
        ...(brokerCostInfo && { brokerCostInfo }),
        ...(tradeExecutedAt && { tradeExecutedAt }),
      }], { session });

      // Track consumed plays for follow purchases (within transaction)
      // Use atomic $inc operator to prevent race conditions
      try {
        // Use atomic bulk update to increment plays for all active follows
        // This prevents race conditions where multiple requests try to increment simultaneously
        if (user.whopUserId) {
          // Atomic update using aggregation pipeline to increment and update status in one operation
          await FollowPurchase.updateMany(
            {
              capperWhopUserId: user.whopUserId,
              status: 'active',
              $expr: { $lt: ['$numPlaysConsumed', '$numPlaysPurchased'] },
            },
            [
              {
                $set: {
                  numPlaysConsumed: { $add: ['$numPlaysConsumed', 1] },
                  status: {
                    $cond: {
                      if: { $gte: [{ $add: ['$numPlaysConsumed', 1] }, '$numPlaysPurchased'] },
                      then: 'completed',
                      else: 'active',
                    },
                  },
                },
              },
            ],
            { session }
          );

          // Invalidate follow cache for all followers of this capper
          // Note: We need to invalidate all followers' caches, but we don't know their IDs here
          // So we'll invalidate on a per-follower basis when they query
          // For now, we'll clear the entire cache (acceptable since plays are consumed infrequently)
          const { clearFollowCache } = await import('@/lib/cache/followCache');
          clearFollowCache();
        }
      } catch (followError) {
        // Don't fail trade creation if follow tracking fails
        console.error('Error tracking follow purchases:', followError);
      }

      // Log the action (within transaction)
      await Log.create([{
        userId: user._id as Types.ObjectId,
        action: 'trade_created',
        metadata: {
          tradeId: trade[0]._id,
          ticker: validated.ticker,
          strike: validated.strike,
          optionType: validated.optionType,
          contracts: validated.contracts,
          fillPrice: finalFillPrice,
        },
      }], { session });

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      const tradeResult = trade[0];

      // Send notification to creator's webhooks (outside transaction - fire and forget)
      notifyTradeCreated(tradeResult, user, membership, companyId || undefined, normalizedSelectedWebhookIds).catch((err) => {
        console.error('Error sending trade creation notification:', err);
      });

      // Notify all followers of this creator (outside transaction - fire and forget)
      import('@/lib/tradeNotifications').then(({ notifyFollowers }) => {
        notifyFollowers(tradeResult, user).catch((followError) => {
          console.error('Error notifying followers:', followError);
        });
      }).catch((err) => {
        console.error('Error importing notifyFollowers:', err);
      });

      // Realtime: push updates to UIs.
      // IMPORTANT: On Vercel/serverless, "fire-and-forget" after responding is unreliable.
      // We await the Pusher triggers here to guarantee delivery.
      // Rule: feed.updated (follower's follow page) is sent ONLY after creator's trade is stored (see commit above).
      // Rule: trade.created for each follower (follower's trade page) is sent in persistFollowerTradesAndNotify ONLY after that follower's trade is saved.
      try {
        // Creator refresh ("My Trades") — after creator trade is stored
        await triggerUserEvent(user.whopUserId, 'trade.created', {
          tradeId: String(tradeResult._id),
          whopUserId: user.whopUserId,
          createdAt: tradeResult.createdAt,
        });

        // Followers refresh ("Following" page) — only after creator trade is created and stored
        const follows = await FollowPurchase.find({
          capperWhopUserId: user.whopUserId,
          status: { $in: ['active', 'completed'] },
        }).select('followerWhopUserId').lean();

        const followerWhopUserIds = (follows || []).map((f) => f.followerWhopUserId).filter(Boolean);
        await triggerUsersEvent(followerWhopUserIds, 'feed.updated', {
          type: 'trade.created',
          creatorWhopUserId: user.whopUserId,
          tradeId: String(tradeResult._id),
          createdAt: tradeResult.createdAt,
        });
      } catch (e) {
        console.error('[Pusher] failed to broadcast trade.created', e);
      }

      // Follower trades run in background: each follower only waits for their own trade (via Pusher).
      // Creator does not wait for follower broker orders or DB writes.
      const orderParams: AutoIQOrderParams = {
        ticker: validated.ticker,
        strike: validated.strike,
        optionType: validated.optionType,
        expiryDate,
        contracts: validated.contracts,
        optionContract: optionContractTicker,
        refPrice: referencePrice,
        refTimestamp,
      };
      (async () => {
        try {
          const eligible = await getEligibleAutoIQFollowersWithBrokers(user);
          if (eligible.length === 0) return;
          const results = await Promise.all(
            eligible.map(({ follower, brokerConnection: conn }) =>
              executeFollowerBrokerOrder(orderParams, follower, conn)
            )
          );
          const successful = results.filter((r): r is FollowerBrokerResult => r != null);
          await persistFollowerTradesAndNotify(tradeResult, user, successful);
        } catch (e) {
          console.error('Error auto-trading for followers (background):', e);
        }
      })();

      invalidateLeaderboardCache();
      if (companyId) {
        invalidateCompanyStatsCache(companyId);
      }
      invalidatePersonalStatsCache(String(user._id));

      // Ensure finalFillPrice is a number before calling toFixed
      const fillPriceNum = typeof finalFillPrice === 'number' && Number.isFinite(finalFillPrice)
        ? finalFillPrice
        : Number(finalFillPrice) || 0;

      const responsePayload = {
        trade: tradeResult,
        message: `Buy Order: ${validated.contracts}x ${validated.ticker} ${validated.strike}${validated.optionType} ${validated.expiryDate} @ $${fillPriceNum.toFixed(2)}`,
        priceInfo: {
          fillPrice: finalFillPrice,
          priceSource: priceSource,
          brokerExecutionPrice: brokerExecutionPrice ?? null,
        },
        // Include broker order details for frontend debugging
        brokerOrderDetails: brokerOrderDetails ?? null,
        brokerCostInfo: brokerCostInfo ?? null,
        tradeExecutedAt: tradeExecutedAt ?? null,
      };

      return NextResponse.json(responsePayload, { status: 201 });
    } catch (transactionError) {
      // Rollback transaction on any error
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      await session.endSession();

      // Re-throw to be handled by outer catch
      throw transactionError;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      metricMeta = { status: 'validation_error' };
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error creating trade:', error);
    metricMeta = { status: 'error' };
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    recordApiMetric('trades#post', {
      durationMs: Math.round(performance.now() - startTime),
      cacheHit: false,
      meta: metricMeta,
    });
  }
}

/**
 * DELETE /api/trades
 * Delete a trade (only if OPEN and before market close)
 */
export async function DELETE(request: NextRequest) {
  const startTime = performance.now();
  let metricMeta: Record<string, unknown> = { status: 'success' };
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      metricMeta = { status: 'unauthorized' };
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find user with company membership
    const { getUserForCompany } = await import('@/lib/userHelpers');
    if (!companyId) {
      metricMeta = { status: 'user_not_found' };
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }
    const userResult = await getUserForCompany(userId, companyId);
    if (!userResult || !userResult.membership) {
      metricMeta = { status: 'user_not_found' };
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { user } = userResult;

    // Allow all roles (companyOwner, owner, admin, member) to delete their own trades
    const limitResult = tradeWriteLimiter.tryConsume(userId);
    if (!limitResult.allowed) {
      metricMeta = { status: 'rate_limited' };
      return NextResponse.json(
        { error: 'Too many trade actions. Please slow down.' },
        {
          status: 429,
          headers: limitResult.retryAfterSeconds
            ? { 'Retry-After': String(limitResult.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    const body = await request.json();
    const { tradeId } = body;

    if (!tradeId) {
      metricMeta = { status: 'missing_trade_id' };
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 });
    }

    const trade = await Trade.findOne({ _id: tradeId, whopUserId: user.whopUserId });
    if (!trade) {
      metricMeta = { status: 'trade_not_found' };
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Only allow deletion of OPEN trades
    if (trade.status !== 'OPEN') {
      metricMeta = { status: 'invalid_status' };
      return NextResponse.json(
        { error: 'Cannot delete trade that is not OPEN.' },
        { status: 403 }
      );
    }

    // Delete associated fills
    await TradeFill.deleteMany({ tradeId: trade._id });

    // Save trade data before deletion for notification
    const tradeData = trade.toObject();
    const selectedWebhookIds = trade.selectedWebhookIds;

    // Delete trade
    await trade.deleteOne();

    await Log.create({
      userId: user._id,
      action: 'trade_deleted',
      metadata: {
        tradeId: trade._id,
        ticker: trade.ticker,
      },
    });

    // Send notification
    await notifyTradeDeleted(tradeData as unknown as ITrade, user, selectedWebhookIds);

    invalidateLeaderboardCache();
    if (companyId) {
      invalidateCompanyStatsCache(companyId);
    }
    invalidatePersonalStatsCache(String(user._id));

    const responsePayload = { success: true };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error deleting trade:', error);
    metricMeta = { status: 'error' };
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    recordApiMetric('trades#delete', {
      durationMs: Math.round(performance.now() - startTime),
      cacheHit: false,
      meta: metricMeta,
    });
  }
}

