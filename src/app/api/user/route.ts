import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { MembershipPlan, Webhook } from '@/models/User';
import { Company } from '@/models/Company';
import { Trade } from '@/models/Trade';
import { getUserForCompany, getUsersInCompanyByRole } from '@/lib/userHelpers';
import { z } from 'zod';
import { PipelineStage } from 'mongoose';
import { aggregationStreakFunction } from '@/lib/aggregation/streaks';
import { AggregatedStats, EMPTY_AGGREGATED_STATS } from '@/types/tradeStats';
import {
  getCompanyStatsCache,
  getPersonalStatsCache,
  setCompanyStatsCache,
  setPersonalStatsCache,
} from '@/lib/cache/statsCache';
import { recordApiMetric, recordCacheMetric } from '@/lib/metrics';
import { performance } from 'node:perf_hooks';

export const runtime = 'nodejs';

async function aggregateTradeStats(match: Record<string, unknown>): Promise<AggregatedStats> {
  const baseMatch = {
    ...match,
    side: 'BUY',
    status: 'CLOSED',
    priceVerified: true,
  };

  const pipeline: PipelineStage[] = [
    { $match: baseMatch },
    {
      $facet: {
        metrics: [
          {
            $group: {
              _id: null,
              totalTrades: { $sum: 1 },
              winCount: { $sum: { $cond: [{ $eq: ['$outcome', 'WIN'] }, 1, 0] } },
              lossCount: { $sum: { $cond: [{ $eq: ['$outcome', 'LOSS'] }, 1, 0] } },
              breakevenCount: { $sum: { $cond: [{ $eq: ['$outcome', 'BREAKEVEN'] }, 1, 0] } },
              netPnl: { $sum: { $ifNull: ['$netPnl', 0] } },
              totalBuyNotional: { $sum: { $ifNull: ['$totalBuyNotional', 0] } },
              totalSellNotional: { $sum: { $ifNull: ['$totalSellNotional', 0] } },
            },
          },
        ],
        outcomes: [
          { $sort: { updatedAt: -1 } },
          {
            $project: {
              outcome: 1,
              updatedAt: { $ifNull: ['$updatedAt', '$createdAt'] },
              createdAt: 1,
            },
          },
          { $limit: 1000 },
        ],
      },
    },
    {
      $addFields: {
        metricsDoc: {
          $ifNull: [
            { $arrayElemAt: ['$metrics', 0] },
            {
              totalTrades: 0,
              winCount: 0,
              lossCount: 0,
              breakevenCount: 0,
              netPnl: 0,
              totalBuyNotional: 0,
              totalSellNotional: 0,
            },
          ],
        },
        tradeOutcomes: '$outcomes',
      },
    },
    {
      $addFields: {
        winRate: {
          $round: [
            {
              $cond: [
                {
                  $gt: [
                    {
                      $add: [
                        { $ifNull: ['$metricsDoc.winCount', 0] },
                        { $ifNull: ['$metricsDoc.lossCount', 0] },
                      ],
                    },
                    0,
                  ],
                },
                {
                  $multiply: [
                    {
                      $divide: [
                        { $ifNull: ['$metricsDoc.winCount', 0] },
                        {
                          $add: [
                            { $ifNull: ['$metricsDoc.winCount', 0] },
                            { $ifNull: ['$metricsDoc.lossCount', 0] },
                          ],
                        },
                      ],
                    },
                    100,
                  ],
                },
                0,
              ],
            },
            2,
          ],
        },
        roi: {
          $round: [
            {
              $cond: [
                { $gt: [{ $ifNull: ['$metricsDoc.totalBuyNotional', 0] }, 0] },
                {
                  $multiply: [
                    {
                      $divide: [
                        { $ifNull: ['$metricsDoc.netPnl', 0] },
                        { $ifNull: ['$metricsDoc.totalBuyNotional', 0] },
                      ],
                    },
                    100,
                  ],
                },
                0,
              ],
            },
            2,
          ],
        },
        averagePnl: {
          $round: [
            {
              $cond: [
                { $gt: [{ $ifNull: ['$metricsDoc.totalTrades', 0] }, 0] },
                {
                  $divide: [
                    { $ifNull: ['$metricsDoc.netPnl', 0] },
                    { $ifNull: ['$metricsDoc.totalTrades', 0] },
                  ],
                },
                0,
              ],
            },
            2,
          ],
        },
      },
    },
    {
      $project: {
        totalTrades: { $ifNull: ['$metricsDoc.totalTrades', 0] },
        winCount: { $ifNull: ['$metricsDoc.winCount', 0] },
        lossCount: { $ifNull: ['$metricsDoc.lossCount', 0] },
        breakevenCount: { $ifNull: ['$metricsDoc.breakevenCount', 0] },
        winRate: { $ifNull: ['$winRate', 0] },
        netPnl: { $round: [{ $ifNull: ['$metricsDoc.netPnl', 0] }, 2] },
        totalBuyNotional: { $round: [{ $ifNull: ['$metricsDoc.totalBuyNotional', 0] }, 2] },
        totalSellNotional: { $round: [{ $ifNull: ['$metricsDoc.totalSellNotional', 0] }, 2] },
        roi: { $ifNull: ['$roi', 0] },
        averagePnl: { $ifNull: ['$averagePnl', 0] },
        tradeOutcomes: '$tradeOutcomes',
      },
    },
  ];

  const result = await Trade.aggregate(pipeline);
  if (!result.length) {
    return EMPTY_AGGREGATED_STATS;
  }
  const { tradeOutcomes = [], ...metricValues } = result[0] as {
    tradeOutcomes?: Array<{ outcome?: string; updatedAt?: Date; createdAt?: Date }>;
  };

  const streaks = aggregationStreakFunction(
    (tradeOutcomes as Array<{ outcome?: string; updatedAt?: Date; createdAt?: Date }> | undefined) || []
  );

  return {
    ...EMPTY_AGGREGATED_STATS,
    ...metricValues,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
  };
}

// Validate Whop product page URL (not checkout links)
const whopProductUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const urlObj = new URL(url);
      // Must be whop.com domain
      if (!urlObj.hostname.includes('whop.com')) return false;
      // Must not be a checkout link (checkout, pay, purchase, etc.)
      const path = urlObj.pathname.toLowerCase();
      const forbiddenPaths = ['/checkout', '/pay', '/purchase', '/buy', '/payment'];
      if (forbiddenPaths.some(forbidden => path.includes(forbidden))) return false;
      // Must not have query params that indicate checkout
      const queryParams = urlObj.searchParams.toString().toLowerCase();
      if (queryParams.includes('checkout') || queryParams.includes('payment')) return false;
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid Whop product page URL (not a checkout link)' }
);

const webhookSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  type: z.enum(['whop', 'discord']),
});

const updateUserSchema = z.object({
  alias: z.string().min(1).max(50).optional(),
  // companyId is auto-set from Whop headers, cannot be manually updated
  companyName: z.string().max(100).optional(), // Only companyOwners can set
  companyDescription: z.string().max(500).optional(), // Only companyOwners can set
  optIn: z.boolean().optional(), // Only owners and companyOwners can opt out (default is opted in)
  hideLeaderboardFromMembers: z.boolean().optional(), // Only companyOwners can set
  hideCompanyStatsFromMembers: z.boolean().optional(), // Only companyOwners can set
  webhooks: z.array(webhookSchema).optional(), // Array of webhooks with names
  notifyOnSettlement: z.boolean().optional(),
  onlyNotifyWinningSettlements: z.boolean().optional(), // Only send settlement webhooks for winning trades
  followingDiscordWebhook: z.string().url().optional().nullable(), // Discord webhook URL for following page notifications
  followingWhopWebhook: z.string().url().optional().nullable(), // Whop webhook URL for following page notifications
  membershipPlans: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    price: z.string().max(50),
    url: whopProductUrlSchema,
    isPremium: z.boolean().optional(),
  })).optional(), // Only owners and companyOwners can manage membership plans
  followOfferEnabled: z.boolean().optional(),
  followOfferPriceCents: z.number().int().min(0).optional(),
  followOfferNumPlays: z.number().int().min(1).optional(),
  followOfferCheckoutUrl: z.string().url().optional().nullable(),
  autoTradeMode: z.enum(['auto-trade', 'notify-only']).optional(),
  defaultBrokerConnectionId: z.string().optional().nullable(),
});

/**
 * GET /api/user
 * Get current user profile and stats
 * For owners: returns both personal stats and company stats (aggregated from all company trades)
 */
export async function GET() {
  const startTime = performance.now();
  let personalCacheHit = false;
  let companyCacheHit: boolean | null = null;
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers (set by client from context)
    const verifiedUserId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');
    if (!verifiedUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    // Find user with company membership
    const userResult = await getUserForCompany(verifiedUserId, companyId);
    if (!userResult || !userResult.membership) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { user, membership } = userResult;

    const personalCacheKey = `personal:${String(user._id)}:${companyId}`;
    let personalStats = getPersonalStatsCache(personalCacheKey);
    personalCacheHit = Boolean(personalStats);
    recordCacheMetric('personalStats', personalCacheHit);
    if (!personalStats) {
      personalStats = await aggregateTradeStats({
        whopUserId: user.whopUserId,
      });
      setPersonalStatsCache(personalCacheKey, personalStats);
    }

    // Get company data
    const company = await Company.findOne({ companyId });

    // Auto-fetch company name from Whop if not set
    if (company && !company.companyName) {
      try {
        const { getWhopCompany } = await import('@/lib/whop');
        const companyData = await getWhopCompany(companyId);
        if (companyData?.name) {
          company.companyName = companyData.name;
          await company.save();
        }
      } catch {
        // Ignore errors
      }
    }

    let hideCompanyStatsFromMembers = true;
    if (membership.role !== 'companyOwner' && membership.role !== 'owner') {
      hideCompanyStatsFromMembers = company?.hideCompanyStatsFromMembers ?? false;
    }

    // For owners and companyOwners: also get company stats (aggregated from all company trades)
    let companyStats = null;
    if ((membership.role === 'owner' || membership.role === 'companyOwner' || ((membership.role === 'member' || membership.role === 'admin') && !hideCompanyStatsFromMembers)) && companyId) {
      // Get all users in the same company with roles that contribute to company stats
      // Exclude members - only include owner/admin/companyOwner roles
      const companyUsers = await getUsersInCompanyByRole(companyId, ['companyOwner', 'owner', 'admin']);
      const companyWhopUserIds = companyUsers.map(u => u.user.whopUserId).filter((id): id is string => Boolean(id));

      // Get all trades from all users in the company (by whopUserId for cross-company aggregation)
      if (companyWhopUserIds.length > 0) {
        const companyCacheKey = `company:${companyId}`;
        const cachedCompanyStats = getCompanyStatsCache(companyCacheKey);
        companyCacheHit = Boolean(cachedCompanyStats);
        if (cachedCompanyStats) {
          companyStats = cachedCompanyStats;
        } else {
          companyStats = await aggregateTradeStats({
            whopUserId: { $in: companyWhopUserIds },
          });
          setCompanyStatsCache(companyCacheKey, companyStats);
          companyCacheHit = false;
        }
        recordCacheMetric('companyStats', companyCacheHit);
      }
    }

    const responsePayload = {
      user: {
        alias: membership.alias,
        role: membership.role,
        companyId: companyId,
        companyName: company?.companyName,
        companyDescription: company?.companyDescription,
        optIn: membership.optIn ?? true,
        whopUsername: user.whopUsername,
        whopDisplayName: user.whopDisplayName,
        whopAvatarUrl: user.whopAvatarUrl,
        webhooks: membership.webhooks || [],
        notifyOnSettlement: membership.notifyOnSettlement ?? false,
        onlyNotifyWinningSettlements: membership.onlyNotifyWinningSettlements ?? false,
        followingDiscordWebhook: user.followingDiscordWebhook || null,
        followingWhopWebhook: user.followingWhopWebhook || null,
        membershipPlans: company?.membershipPlans || [],
        hideLeaderboardFromMembers: company?.hideLeaderboardFromMembers ?? false,
        hideCompanyStatsFromMembers: company?.hideCompanyStatsFromMembers ?? false,
        followOfferEnabled: membership.followOfferEnabled ?? false,
        followOfferPriceCents: membership.followOfferPriceCents ?? 0,
        followOfferNumPlays: membership.followOfferNumPlays ?? 0,
        followOfferCheckoutUrl: membership.followOfferCheckoutUrl ?? null,
        hasAutoIQ: user.hasAutoIQ ?? false,
        autoTradeMode: user.autoTradeMode ?? 'notify-only',
        defaultBrokerConnectionId: user.defaultBrokerConnectionId ? String(user.defaultBrokerConnectionId) : null,
      },
      personalStats,
      companyStats, // Only for owners with companyId
    };

    recordApiMetric('user#get', {
      durationMs: Math.round(performance.now() - startTime),
      cacheHit: personalCacheHit && (companyCacheHit ?? true),
      meta: { role: membership.role },
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user
 * Update user profile
 * - Only owners can opt out of leaderboard (default is opted in)
 * - Only owners can manage membership plans
 * - Only owners can set companyName and companyDescription
 * - Enforce only 1 owner per companyId
 */
export async function PATCH(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers (set by client from context)
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = updateUserSchema.parse(body);

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    // Find user with company membership
    const { getUserForCompany, updateCompanyMembership, getOrCreateCompany } = await import('@/lib/userHelpers');
    const userResult = await getUserForCompany(userId, companyId);
    if (!userResult || !userResult.membership) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { user, membership } = userResult;

    // Get or create company
    let company = await Company.findOne({ companyId });
    if (!company && membership.role === 'companyOwner') {
      const { company: newCompany } = await getOrCreateCompany(companyId, userId);
      company = newCompany;
    }

    // Update membership fields (company-specific)
    const membershipUpdates: Partial<typeof membership> = {};

    // Update alias (all roles can update)
    if (validated.alias !== undefined) {
      membershipUpdates.alias = validated.alias;
    }

    // Only owners and companyOwners can opt out of leaderboard (default is opted in)
    if (validated.optIn !== undefined) {
      if (membership.role === 'companyOwner' || membership.role === 'owner') {
        membershipUpdates.optIn = validated.optIn;
      } else {
        return NextResponse.json(
          { error: 'Only owners and company owners can opt out of leaderboard' },
          { status: 403 }
        );
      }
    }

    // Update webhooks array (all roles can update)
    if (validated.webhooks !== undefined) {
      membershipUpdates.webhooks = validated.webhooks as Webhook[];
    }

    if (validated.notifyOnSettlement !== undefined) {
      membershipUpdates.notifyOnSettlement = validated.notifyOnSettlement;
    }

    if (validated.onlyNotifyWinningSettlements !== undefined) {
      membershipUpdates.onlyNotifyWinningSettlements = validated.onlyNotifyWinningSettlements;
    }

    // Update follow offer settings (per company)
    if (validated.followOfferEnabled !== undefined) {
      membershipUpdates.followOfferEnabled = validated.followOfferEnabled;
    }
    if (validated.followOfferPriceCents !== undefined) {
      membershipUpdates.followOfferPriceCents = validated.followOfferPriceCents;
    }
    if (validated.followOfferNumPlays !== undefined) {
      membershipUpdates.followOfferNumPlays = validated.followOfferNumPlays;
    }
    if (validated.followOfferCheckoutUrl !== undefined) {
      membershipUpdates.followOfferCheckoutUrl = validated.followOfferCheckoutUrl || undefined;
    }

    // Apply membership updates
    if (Object.keys(membershipUpdates).length > 0) {
      await updateCompanyMembership(userId, companyId, membershipUpdates);
    }

    // Update company-level settings (only companyOwners)
    if (membership.role === 'companyOwner' && company) {
      const companyUpdates: Partial<typeof company> = {};

      if (validated.companyName !== undefined) {
        companyUpdates.companyName = validated.companyName || undefined;
      }
      if (validated.companyDescription !== undefined) {
        companyUpdates.companyDescription = validated.companyDescription || undefined;
      }
      if (validated.membershipPlans !== undefined) {
        companyUpdates.membershipPlans = validated.membershipPlans as MembershipPlan[];
      }
      if (validated.hideLeaderboardFromMembers !== undefined) {
        companyUpdates.hideLeaderboardFromMembers = validated.hideLeaderboardFromMembers;
      }
      if (validated.hideCompanyStatsFromMembers !== undefined) {
        companyUpdates.hideCompanyStatsFromMembers = validated.hideCompanyStatsFromMembers;
      }

      if (Object.keys(companyUpdates).length > 0) {
        Object.assign(company, companyUpdates);
        await company.save();
      }
    } else {
      // Non-owners cannot update company settings
      if (validated.companyName !== undefined || validated.companyDescription !== undefined ||
        validated.membershipPlans !== undefined || validated.hideLeaderboardFromMembers !== undefined ||
        validated.hideCompanyStatsFromMembers !== undefined) {
        return NextResponse.json(
          { error: 'Only company owners can update company settings' },
          { status: 403 }
        );
      }
    }

    // Update person-level following webhooks (all roles can update)
    const userUpdates: Partial<typeof user> = {};
    if (validated.followingDiscordWebhook !== undefined) {
      userUpdates.followingDiscordWebhook = validated.followingDiscordWebhook || undefined;
    }
    if (validated.followingWhopWebhook !== undefined) {
      userUpdates.followingWhopWebhook = validated.followingWhopWebhook || undefined;
    }
    // Update AutoIQ mode (only if user has AutoIQ subscription)
    if (validated.autoTradeMode !== undefined) {
      if (!user.hasAutoIQ) {
        return NextResponse.json(
          { error: 'AutoIQ subscription required to change auto-trade mode' },
          { status: 403 }
        );
      }
      userUpdates.autoTradeMode = validated.autoTradeMode;
    }
    // Update default broker connection for AutoIQ (only if user has AutoIQ subscription)
    if (validated.defaultBrokerConnectionId !== undefined) {
      if (!user.hasAutoIQ) {
        return NextResponse.json(
          { error: 'AutoIQ subscription required to set default broker connection' },
          { status: 403 }
        );
      }
      // Validate that the broker connection exists and belongs to the user
      if (validated.defaultBrokerConnectionId) {
        const { BrokerConnection } = await import('@/models/BrokerConnection');
        const brokerConnection = await BrokerConnection.findOne({
          _id: validated.defaultBrokerConnectionId,
          whopUserId: user.whopUserId,
          isActive: true,
        });
        if (!brokerConnection) {
          return NextResponse.json(
            { error: 'Broker connection not found or not active' },
            { status: 404 }
          );
        }
        userUpdates.defaultBrokerConnectionId = brokerConnection._id;
      } else {
        userUpdates.defaultBrokerConnectionId = undefined;
      }
    }

    if (Object.keys(userUpdates).length > 0) {
      Object.assign(user, userUpdates);
      await user.save();
    }

    // Refresh data for response
    const updatedResult = await getUserForCompany(userId, companyId);
    const updatedMembership = updatedResult?.membership;
    const updatedCompany = await Company.findOne({ companyId });

    return NextResponse.json({
      message: 'User updated successfully',
      user: {
        alias: updatedMembership?.alias || membership.alias,
        role: updatedMembership?.role || membership.role,
        companyId: companyId,
        companyName: updatedCompany?.companyName,
        companyDescription: updatedCompany?.companyDescription,
        optIn: updatedMembership?.optIn ?? membership.optIn ?? true,
        membershipPlans: updatedCompany?.membershipPlans || [],
        followOfferEnabled: updatedMembership?.followOfferEnabled ?? false,
        followOfferPriceCents: updatedMembership?.followOfferPriceCents ?? 0,
        followOfferNumPlays: updatedMembership?.followOfferNumPlays ?? 0,
        followOfferCheckoutUrl: updatedMembership?.followOfferCheckoutUrl ?? null,
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
