/**
 * Helper functions for working with the new User model structure
 * These functions abstract the complexity of companyMemberships array
 */

import { User, IUser, CompanyMembership, UserRole } from '@/models/User';
import { Company } from '@/models/Company';

/**
 * Get user with specific company membership
 * Returns user and their membership for the given company, or null if not found
 */
export async function getUserForCompany(
    whopUserId: string,
    companyId: string
): Promise<{ user: IUser; membership: CompanyMembership | null } | null> {
    const user = await User.findOne({ whopUserId });
    if (!user) return null;

    const membership = user.companyMemberships.find(
        (m: CompanyMembership) => m.companyId === companyId
    ) || null;

    return { user, membership };
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
        await user.save();
    }

    return { user, membership };
}

/**
 * Update company membership
 * Updates fields in the companyMemberships array for a specific company
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

    await User.updateOne(
        {
            whopUserId,
            'companyMemberships.companyId': companyId,
        },
        { $set: setFields }
    );
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

