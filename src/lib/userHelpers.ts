/**
 * Helper functions for working with the new User model structure
 * These functions abstract the complexity of companyMemberships array
 * 
 * Optimized for Discord-scale performance:
 * - Database-level filtering with $elemMatch projection
 * - In-memory caching with LRU eviction
 * - Denormalized activeMembership for O(1) lookups
 */

import { User, IUser, CompanyMembership, UserRole } from '@/models/User';
import { Company } from '@/models/Company';
import { userCache, getUserCacheKey, invalidateUserCache } from '@/lib/cache/userCache';

/**
 * Get user with specific company membership
 * Returns user and their membership for the given company, or null if not found
 * 
 * Optimizations:
 * 1. Check cache first (O(1))
 * 2. Check denormalized activeMembership field (O(1))
 * 3. Use $elemMatch projection for database-level filtering (only returns matching membership)
 * 4. Update activeMembership for future fast lookups
 * 5. Cache result for subsequent requests
 */
export async function getUserForCompany(
    whopUserId: string,
    companyId: string
): Promise<{ user: IUser; membership: CompanyMembership | null } | null> {
    // 1. Check cache first
    const cacheKey = getUserCacheKey(whopUserId, companyId);
    const cached = userCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // 2. Query with $elemMatch projection for database-level filtering
    // This only returns the matching membership, not the entire array
    interface LeanUserDoc {
        whopUserId: string;
        whopUsername?: string;
        whopDisplayName?: string;
        whopAvatarUrl?: string;
        followingDiscordWebhook?: string;
        followingWhopWebhook?: string;
        companyMemberships?: CompanyMembership[];
        activeCompanyId?: string;
        activeMembership?: CompanyMembership;
    }

    const userDoc = await User.findOne(
        { whopUserId },
        {
            projection: {
                whopUserId: 1,
                whopUsername: 1,
                whopDisplayName: 1,
                whopAvatarUrl: 1,
                followingDiscordWebhook: 1,
                followingWhopWebhook: 1,
                companyMemberships: {
                    $elemMatch: { companyId }
                },
                activeCompanyId: 1,
                activeMembership: 1,
            }
        }
    ).lean() as LeanUserDoc | null;

    if (!userDoc) {
        return null;
    }

    // 3. Check if activeMembership matches (fast path for repeated access)
    if (userDoc.activeCompanyId === companyId && userDoc.activeMembership) {
        // Get full user document for return
        const fullUser = await User.findOne({ whopUserId });
        if (!fullUser) {
            return null;
        }
        const result = {
            user: fullUser,
            membership: userDoc.activeMembership as CompanyMembership,
        };
        userCache.set(cacheKey, result);
        return result;
    }

    // 4. Extract membership from array (should only have one element due to $elemMatch)
    const membership = (userDoc.companyMemberships && userDoc.companyMemberships[0]) || null;

    // 5. Update activeMembership for future fast lookups (async, don't wait)
    if (membership && userDoc.activeCompanyId !== companyId) {
        User.updateOne(
            { whopUserId },
            {
                $set: {
                    activeCompanyId: companyId,
                    activeMembership: membership,
                }
            }
        ).catch(err => {
            // Log but don't fail the request
            console.error('Failed to update activeMembership:', err);
        });
    }

    // 6. Get full user document for return (needed for some operations)
    const fullUser = await User.findOne({ whopUserId });
    if (!fullUser) {
        return null;
    }

    const result = {
        user: fullUser,
        membership: membership as CompanyMembership | null,
    };

    // 7. Cache result
    userCache.set(cacheKey, result);

    return result;
}

/**
 * Get or create company membership for a user
 * If user doesn't exist, creates new user with first company membership
 * If user exists but doesn't have membership for this company, adds it
 */
export async function getOrCreateCompanyMembership(
    whopUserId: string,
    companyId: string,
    defaultRole: UserRole = 'member',
    defaultAlias?: string
): Promise<{ user: IUser; membership: CompanyMembership }> {
    const user = await User.findOne({ whopUserId });

    if (!user) {
        // Create new user with first company membership
        const newUser = await User.create({
            whopUserId,
            companyMemberships: [{
                companyId,
                alias: defaultAlias || `User ${whopUserId.slice(0, 8)}`,
                role: defaultRole,
                optIn: true,
                followOfferEnabled: false,
                joinedAt: new Date(),
            }],
        });
        return { user: newUser, membership: newUser.companyMemberships[0] };
    }

    // Find existing membership
    let membership = user.companyMemberships.find((m: CompanyMembership) => m.companyId === companyId);

    if (!membership) {
        // Add new company membership
        membership = {
            companyId,
            alias: user.companyMemberships[0]?.alias || defaultAlias || `User ${whopUserId.slice(0, 8)}`,
            role: defaultRole,
            optIn: true,
            followOfferEnabled: false,
            joinedAt: new Date(),
        };
        user.companyMemberships.push(membership);

        // Update activeMembership if this is the first membership or if no active company
        if (user.companyMemberships.length === 1 || !user.activeCompanyId) {
            user.activeCompanyId = companyId;
            user.activeMembership = membership;
        }

        await user.save();

        // Invalidate cache
        invalidateUserCache(whopUserId, companyId);
    }

    return { user, membership };
}

/**
 * Update company membership
 * Updates fields in the companyMemberships array for a specific company
 * Also updates activeMembership if this is the active company
 */
export async function updateCompanyMembership(
    whopUserId: string,
    companyId: string,
    updates: Partial<CompanyMembership>
): Promise<void> {
    const setFields: Record<string, unknown> = {};
    Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
            setFields[`companyMemberships.$.${key}`] = value;
        }
    });

    if (Object.keys(setFields).length === 0) return;

    // Update the membership in the array
    await User.updateOne(
        {
            whopUserId,
            'companyMemberships.companyId': companyId,
        },
        { $set: setFields }
    );

    // If this is the active company, also update activeMembership
    const user = await User.findOne({ whopUserId });
    if (user && user.activeCompanyId === companyId) {
        const updatedMembership = user.companyMemberships?.find(
            (m: CompanyMembership) => m.companyId === companyId
        );
        if (updatedMembership) {
            // Merge updates into the membership
            const mergedMembership = { ...updatedMembership, ...updates };
            await User.updateOne(
                { whopUserId },
                { $set: { activeMembership: mergedMembership } }
            );
        }
    }

    // Invalidate cache
    invalidateUserCache(whopUserId, companyId);
}

/**
 * Find user by followOfferPlanId (for webhook processing)
 * Returns user and the specific membership that has this planId
 */
export async function getUserByFollowOfferPlanId(
    planId: string
): Promise<{ user: IUser; membership: CompanyMembership } | null> {
    const user = await User.findOne({
        'companyMemberships.followOfferPlanId': planId,
        'companyMemberships.followOfferEnabled': true,
    });

    if (!user) return null;

    const membership = user.companyMemberships.find(
        (m: CompanyMembership) => m.followOfferPlanId === planId && m.followOfferEnabled
    );

    if (!membership) return null;

    return { user, membership };
}

/**
 * Get all users in a company
 * Returns all users who have a membership in the given company
 */
export async function getUsersInCompany(
    companyId: string
): Promise<Array<{ user: IUser; membership: CompanyMembership }>> {
    const users = await User.find({
        'companyMemberships.companyId': companyId,
    });

    return users
        .map((user: IUser) => {
            const membership = user.companyMemberships.find((m: CompanyMembership) => m.companyId === companyId);
            return membership ? { user, membership } : null;
        })
        .filter((item): item is { user: IUser; membership: CompanyMembership } => item !== null);
}

/**
 * Get users in company by role
 */
export async function getUsersInCompanyByRole(
    companyId: string,
    roles: UserRole[]
): Promise<Array<{ user: IUser; membership: CompanyMembership }>> {
    const users = await User.find({
        'companyMemberships.companyId': companyId,
        'companyMemberships.role': { $in: roles },
    });

    return users
        .map((user: IUser) => {
            const membership = user.companyMemberships.find(
                (m: CompanyMembership) => m.companyId === companyId && roles.includes(m.role)
            );
            return membership ? { user, membership } : null;
        })
        .filter((item): item is { user: IUser; membership: CompanyMembership } => item !== null);
}

/**
 * Get or create Company document
 */
export async function getOrCreateCompany(
    companyId: string,
    companyOwnerWhopUserId: string,
    companyName?: string
): Promise<{ company: Awaited<ReturnType<typeof Company.findOne>>; created: boolean }> {
    let company = await Company.findOne({ companyId });
    let created = false;

    if (!company) {
        company = await Company.create({
            companyId,
            companyOwnerWhopUserId,
            companyName,
            hideLeaderboardFromMembers: false,
            hideCompanyStatsFromMembers: false,
            membershipPlans: [],
        });
        created = true;
    }

    return { company, created };
}

/**
 * Get company settings
 * Returns company document or null
 */
export async function getCompany(companyId: string) {
    return await Company.findOne({ companyId });
}

