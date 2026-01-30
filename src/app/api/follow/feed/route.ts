import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { Trade, ITrade } from '@/models/Trade';
import { FollowPurchase, IFollowPurchase } from '@/models/FollowPurchase';
import { FollowedTradeAction } from '@/models/FollowedTradeAction';
import mongoose, { PipelineStage } from 'mongoose';

export const runtime = 'nodejs';

// Type for trade documents from aggregation pipeline (includes capperWhopUserId)
type TradeWithCapper = ITrade & {
  capperWhopUserId?: string;
};

// Performance monitoring helper
const logPerformance = (label: string, startTime: number) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Performance] ${label}: ${Date.now() - startTime}ms`);
  }
};

/**
 * GET /api/follow/feed
 * Returns trades from creators the user is following
 * Shows trades from ALL companies where followed creators exist (person-level tracking)
 * 
 * Production-optimized with:
 * - Advanced MongoDB aggregation pipelines
 * - Efficient per-capper limiting using $setWindowFields
 * - Minimal in-memory processing
 * - Proper error handling and validation
 * - Performance monitoring
 */
export async function GET(request: NextRequest) {
  const overallStart = Date.now();

  try {
    await connectDB();

    const headers = await import('next/headers').then(m => m.headers());
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    // Input validation
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get and validate pagination and search params
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10)));
    const search = (searchParams.get('search') || '').trim();

    // Step 1: Find user with company membership
    const { getUserForCompany } = await import('@/lib/userHelpers');
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }
    const userStart = Date.now();
    const userResult = await getUserForCompany(userId, companyId);
    if (!userResult || !userResult.membership) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userDocTyped = { whopUserId: userResult.user.whopUserId };

    const user = { whopUserId: userDocTyped.whopUserId };
    logPerformance('User lookup', userStart);

    // Step 2: Get all follow purchases (single optimized query with cache)
    const followsStart = Date.now();
    const { getActiveFollowsCache, setActiveFollowsCache } = await import('@/lib/cache/followCache');
    let allFollows = getActiveFollowsCache(user.whopUserId);

    if (!allFollows) {
      // Cache miss - query database
      const follows = await FollowPurchase.find({
        followerWhopUserId: user.whopUserId,
        status: { $in: ['active', 'completed'] },
      })
        // We need createdAt (follow start) + updatedAt (completion time when status flips to completed)
        .select('capperWhopUserId capperUserId companyId numPlaysPurchased numPlaysConsumed status createdAt updatedAt')
        .lean();
      allFollows = follows as unknown as IFollowPurchase[];
      // Cache result
      setActiveFollowsCache(user.whopUserId, allFollows);
    }

    if (allFollows.length === 0) {
      return NextResponse.json({
        trades: [],
        follows: [],
        page,
        pageSize,
        total: 0,
        totalPages: 0,
      });
    }
    logPerformance('Follows lookup', followsStart);

    // Step 3: Build capper metadata maps (single pass, O(n))
    const metadataStart = Date.now();
    const allCapperWhopUserIds = new Set<string>();
    const capperEarliestDate = new Map<string, Date>();
    // Follow windows per creator: [follow.createdAt, followEnd] where followEnd is:
    // - now if follow is active
    // - follow.updatedAt if completed (status is flipped to completed when plays are exhausted)
    const followWindowsByCapper = new Map<string, Array<{ start: Date; end: Date }>>();
    const followMetadataByFollowId = new Map<string, {
      followPurchaseId: string;
      totalPlaysPurchased: number;
      remainingPlays: number;
      createdAt: Date;
      capperWhopUserId: string;
    }>();
    // One follow row per creator for UI + trade metadata:
    // - If an active follow exists for a creator, show ONLY that (hide completed history).
    // - Otherwise, show exactly one completed follow (the most recent) so users can see completion.
    const selectedFollowByCapper = new Map<string, IFollowPurchase>();
    const selectedFollowMetaByCapper = new Map<string, {
      followPurchaseId: string;
      totalPlaysPurchased: number;
      remainingPlays: number;
      createdAt: Date;
      capperWhopUserId: string;
      status: 'active' | 'completed';
    }>();

    for (const follow of allFollows) {
      if (!follow.capperWhopUserId) continue;

      allCapperWhopUserIds.add(follow.capperWhopUserId);
      const followId = String(follow._id);
      const remainingPlays = Math.max(0, follow.numPlaysPurchased - follow.numPlaysConsumed);

      const meta = {
        followPurchaseId: followId,
        totalPlaysPurchased: follow.numPlaysPurchased,
        remainingPlays,
        createdAt: follow.createdAt,
        capperWhopUserId: follow.capperWhopUserId,
      };
      followMetadataByFollowId.set(followId, meta);

      // Select the single follow record to represent this creator in the UI:
      // prefer active over completed; among completed, prefer most recent.
      if (follow.status === 'active' || follow.status === 'completed') {
        // Track follow window for this creator (used to filter trades by duration of follow)
        const start = follow.createdAt;
        const end = follow.status === 'completed'
          ? (follow.updatedAt ?? follow.createdAt)
          : new Date();
        if (end >= start) {
          const windows = followWindowsByCapper.get(follow.capperWhopUserId) ?? [];
          windows.push({ start, end });
          followWindowsByCapper.set(follow.capperWhopUserId, windows);
        }

        const existing = selectedFollowMetaByCapper.get(follow.capperWhopUserId);
        if (!existing) {
          selectedFollowByCapper.set(follow.capperWhopUserId, follow);
          selectedFollowMetaByCapper.set(follow.capperWhopUserId, { ...meta, status: follow.status });
        } else if (existing.status === 'active') {
          // If we somehow have multiple actives (shouldn't), keep the most recent.
          if (follow.status === 'active' && follow.createdAt > existing.createdAt) {
            selectedFollowByCapper.set(follow.capperWhopUserId, follow);
            selectedFollowMetaByCapper.set(follow.capperWhopUserId, { ...meta, status: follow.status });
          }
        } else {
          // existing is completed
          if (follow.status === 'active') {
            // Active overrides completed (hide completed history)
            selectedFollowByCapper.set(follow.capperWhopUserId, follow);
            selectedFollowMetaByCapper.set(follow.capperWhopUserId, { ...meta, status: follow.status });
          } else if (follow.createdAt > existing.createdAt) {
            // More recent completed replaces older completed
            selectedFollowByCapper.set(follow.capperWhopUserId, follow);
            selectedFollowMetaByCapper.set(follow.capperWhopUserId, { ...meta, status: follow.status });
          }
        }
      }

      // Track earliest date per capper
      const existingDate = capperEarliestDate.get(follow.capperWhopUserId);
      if (!existingDate || follow.createdAt < existingDate) {
        capperEarliestDate.set(follow.capperWhopUserId, follow.createdAt);
      }
    }
    logPerformance('Metadata building', metadataStart);

    // Step 4: Get capper user info (single batch query with projection)
    const capperInfoStart = Date.now();
    const allCapperUsers = await User.find({
      whopUserId: { $in: Array.from(allCapperWhopUserIds) },
    })
      .select('_id whopUserId alias whopUsername whopDisplayName whopAvatarUrl companyMemberships')
      .lean();

    // Get unique companyIds from follow purchases (these are the capper's companies)
    const capperCompanyIds = new Set<string>();
    for (const follow of allFollows) {
      if (follow.companyId) {
        capperCompanyIds.add(follow.companyId);
      }
    }

    // Get company colors for cappers using companyId from FollowPurchase
    const { Company } = await import('@/models/Company');
    const capperCompanies = await Company.find({
      companyId: { $in: Array.from(capperCompanyIds) },
    })
      .select('companyId primaryColor secondaryColor')
      .lean();

    // Build company color map
    const companyColorMap = new Map<string, { primaryColor?: string; secondaryColor?: string }>();
    for (const company of capperCompanies) {
      companyColorMap.set(company.companyId, {
        primaryColor: company.primaryColor || undefined,
        secondaryColor: company.secondaryColor || undefined,
      });
    }

    // Build capper info map (single pass)
    const capperInfoMap = new Map<string, {
      alias?: string;
      whopUsername?: string;
      whopDisplayName?: string;
      whopAvatarUrl?: string;
    }>();

    for (const capperUser of allCapperUsers) {
      if (capperUser.whopUserId && !capperInfoMap.has(capperUser.whopUserId)) {
        // Get alias from companyOwner membership
        let alias: string | undefined;
        if (capperUser.companyMemberships && Array.isArray(capperUser.companyMemberships)) {
          const ownerMembership = capperUser.companyMemberships.find(
            (m: { role?: string; alias?: string }) => m.role === 'companyOwner'
          );
          alias = ownerMembership?.alias;
        }

        capperInfoMap.set(capperUser.whopUserId, {
          alias: alias || capperUser.alias,
          whopUsername: capperUser.whopUsername,
          whopDisplayName: capperUser.whopDisplayName,
          whopAvatarUrl: capperUser.whopAvatarUrl,
        });
      }
    }
    logPerformance('Capper info lookup', capperInfoStart);

    // Step 5: Trade fetching with MongoDB aggregation
    // NOTE: We only use pagination here (page/pageSize). We do NOT hard-limit
    // the number of trades per creator; all eligible trades are pageable.
    const tradesStart = Date.now();
    let allTradesRaw: TradeWithCapper[] = [];
    let totalTrades = 0;

    if (followWindowsByCapper.size > 0) {
      // Build $or conditions for match stage using FOLLOW WINDOWS:
      // include trades only when the follow was active, i.e.
      // trade.createdAt ∈ [follow.createdAt, followEnd] where followEnd is:
      // - now (if active)
      // - follow.updatedAt (if completed)
      //
      // If the user renewed follows, we may have multiple windows per creator;
      // merge overlapping windows to keep the $or compact.
      const matchConditions: Array<Record<string, unknown>> = [];

      for (const [capperWhopUserId, windows] of followWindowsByCapper.entries()) {
        if (!windows || windows.length === 0) continue;
        const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
        const merged: Array<{ start: Date; end: Date }> = [];

        for (const w of sorted) {
          const last = merged[merged.length - 1];
          if (!last) {
            merged.push({ start: w.start, end: w.end });
            continue;
          }
          if (w.start.getTime() <= last.end.getTime()) {
            // overlap → extend end
            if (w.end.getTime() > last.end.getTime()) last.end = w.end;
          } else {
            merged.push({ start: w.start, end: w.end });
          }
        }

        for (const w of merged) {
          matchConditions.push({
            whopUserId: capperWhopUserId,
            createdAt: { $gte: w.start, $lte: w.end },
          });
        }
      }

      if (matchConditions.length > 0) {
        const baseMatchConditions: Record<string, unknown> = {
          side: 'BUY',
          status: { $in: ['OPEN', 'CLOSED'] },
          $or: matchConditions,
        };

        if (search) {
          const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          baseMatchConditions.ticker = regex;
        }

        const tradePipeline: PipelineStage[] = [
          { $match: baseMatchConditions },
          { $addFields: { capperWhopUserId: '$whopUserId' } },
          { $sort: { createdAt: -1 } }, // newest first for feed
          {
            $facet: {
              data: [
                { $skip: (page - 1) * pageSize },
                { $limit: pageSize },
              ],
              totalCount: [{ $count: 'count' }],
            },
          },
        ];

        const result = await Trade.aggregate(tradePipeline).allowDiskUse(true);
        const facetResult = result[0] || { data: [], totalCount: [] };
        allTradesRaw = facetResult.data || [];
        totalTrades = facetResult.totalCount[0]?.count || 0;
      } else {
        allTradesRaw = [];
        totalTrades = 0;
      }
    }
    logPerformance('Trades aggregation', tradesStart);

    // Step 6: Get action status for paginated trades only (optimized batch query)
    const actionsStart = Date.now();
    const tradeIds = allTradesRaw.length > 0
      ? allTradesRaw.map(trade => {
        const id = trade._id;
        return id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));
      })
      : [];

    const actions = tradeIds.length > 0
      ? await FollowedTradeAction.find({
        followerWhopUserId: user.whopUserId,
        originalTradeId: { $in: tradeIds },
      })
        .select('originalTradeId action followedTradeId')
        .lean()
      : [];

    // Build action map (single pass)
    const actionMap = new Map<string, { action: 'follow' | 'fade'; followedTradeId?: string }>();
    for (const action of actions) {
      const tradeIdStr = action.originalTradeId instanceof mongoose.Types.ObjectId
        ? action.originalTradeId.toString()
        : String(action.originalTradeId);
      actionMap.set(tradeIdStr, {
        action: action.action,
        followedTradeId: action.followedTradeId ? String(action.followedTradeId) : undefined,
      });
    }
    logPerformance('Actions lookup', actionsStart);

    // Step 7: Build capper-to-follow mapping (for trade metadata)
    const capperToFollowMap = new Map<string, {
      followPurchaseId: string;
      totalPlaysPurchased: number;
      remainingPlays: number;
      createdAt: Date;
      capperWhopUserId: string;
    }>();

    // Use the selected follow per capper so trade metadata matches the UI (no duplicates).
    for (const meta of selectedFollowMetaByCapper.values()) {
      capperToFollowMap.set(meta.capperWhopUserId, {
        followPurchaseId: meta.followPurchaseId,
        totalPlaysPurchased: meta.totalPlaysPurchased,
        remainingPlays: meta.remainingPlays,
        createdAt: meta.createdAt,
        capperWhopUserId: meta.capperWhopUserId,
      });
    }

    // Step 8: Format trades with follow info and action status
    const formattingStart = Date.now();
    const trades = allTradesRaw.map((trade) => {
      const capperWhopUserId = trade.capperWhopUserId;
      const metadata = capperWhopUserId ? capperToFollowMap.get(capperWhopUserId) : undefined;
      const tradeId = trade._id instanceof mongoose.Types.ObjectId
        ? trade._id.toString()
        : String(trade._id);
      const actionData = actionMap.get(tradeId);

      // Remove internal fields
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { capperWhopUserId: _, ...tradeData } = trade;

      return {
        ...tradeData,
        followInfo: {
          followPurchaseId: metadata?.followPurchaseId || '',
          remainingPlays: metadata?.remainingPlays || 0,
        },
        actionStatus: actionData ? {
          action: actionData.action,
          followedTradeId: actionData.followedTradeId,
        } : null,
      };
    });
    logPerformance('Trade formatting', formattingStart);

    // Step 9: Format follow info
    // Return one row per creator:
    // - active follow if present
    // - else one completed follow (most recent)
    const follows = Array.from(selectedFollowByCapper.values())
      .sort((a, b) => {
        // Active first, then completed; within same status, newest first
        if (a.status !== b.status) {
          return a.status === 'active' ? -1 : 1;
        }
        return (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0);
      })
      .map((follow) => {
        const capperInfo = capperInfoMap.get(follow.capperWhopUserId || '') || {};
        const remainingPlays = Math.max(0, follow.numPlaysPurchased - follow.numPlaysConsumed);

        // Get company colors using companyId from FollowPurchase
        const companyColors = follow.companyId ? companyColorMap.get(follow.companyId) : undefined;

        return {
          followPurchaseId: String(follow._id),
          capper: {
            userId: String(follow.capperUserId),
            alias: capperInfo.alias || capperInfo.whopDisplayName || capperInfo.whopUsername || 'Unknown',
            avatarUrl: capperInfo.whopAvatarUrl,
            primaryColor: companyColors?.primaryColor || null,
            secondaryColor: companyColors?.secondaryColor || null,
          },
          numPlaysPurchased: follow.numPlaysPurchased,
          numPlaysConsumed: follow.numPlaysConsumed,
          remainingPlays,
          status: follow.status,
          createdAt: follow.createdAt,
        };
      });

    logPerformance('Total request', overallStart);

    return NextResponse.json({
      trades,
      follows,
      page,
      pageSize,
      total: totalTrades,
      totalPages: Math.ceil(totalTrades / pageSize),
      hasMore: page * pageSize < totalTrades,
    });
  } catch (error) {
    console.error('[FollowFeed] Error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

