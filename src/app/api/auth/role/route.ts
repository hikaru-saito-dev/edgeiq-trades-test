import { NextRequest, NextResponse } from 'next/server';
import { verifyWhopUser, getWhopUser, getWhopCompany } from '@/lib/whop';
import connectDB from '@/lib/db';
import { Company } from '@/models/Company';
import { getOrCreateCompanyMembership, getOrCreateCompany } from '@/lib/userHelpers';

export const runtime = 'nodejs';

/**
 * Ensure user exists in database (create if doesn't exist)
 * companyId is auto-set from Whop headers
 * First user in each company becomes companyOwner
 */
async function ensureUserExists(userId: string, companyId?: string): Promise<'companyOwner' | 'owner' | 'admin' | 'member' | 'none'> {
  try {
    await connectDB();

    if (!companyId) {
      // If no companyId, user can't be created/authenticated
      return 'none';
    }

    // Always try to fetch latest user data from Whop API
    let whopUserData = null;
    let whopCompanyData = null;
    try {
      whopUserData = await getWhopUser(userId);
      whopCompanyData = await getWhopCompany(companyId);
    } catch {
      // Continue even if Whop API calls fail
    }

    // Get or create company
    if (whopCompanyData) {
      await getOrCreateCompany(companyId, userId, whopCompanyData.name);
    }

    // Check if this is the first user in this company
    const { getUsersInCompanyByRole } = await import('@/lib/userHelpers');
    const existingOwners = await getUsersInCompanyByRole(companyId, ['companyOwner', 'owner']);
    const isFirstUserInCompany = existingOwners.length === 0;

    // Get or create user membership
    const defaultRole: 'companyOwner' | 'member' = isFirstUserInCompany ? 'companyOwner' : 'member';
    const defaultAlias = whopUserData?.name || whopUserData?.username || `User ${userId.slice(0, 8)}`;

    const { user, membership } = await getOrCreateCompanyMembership(
      userId,
      companyId,
      defaultRole,
      defaultAlias
    );

    // Update person-level data from Whop
    const updates: {
      whopUsername?: string;
      whopDisplayName?: string;
      whopAvatarUrl?: string;
    } = {};

    if (whopUserData) {
      if (whopUserData.username && whopUserData.username !== user.whopUsername) {
        updates.whopUsername = whopUserData.username;
      }
      if (whopUserData.name && whopUserData.name !== user.whopDisplayName) {
        updates.whopDisplayName = whopUserData.name;
      }
      if (whopUserData.profilePicture?.sourceUrl) {
        if (whopUserData.profilePicture.sourceUrl !== user.whopAvatarUrl) {
          updates.whopAvatarUrl = whopUserData.profilePicture.sourceUrl;
        }
      }
    }

    // Update user if there are changes
    if (Object.keys(updates).length > 0) {
      Object.assign(user, updates);
      await user.save();
    }

    return membership.role;
  } catch (error) {
    console.error('Error ensuring user exists:', error);
    return 'none';
  }
}

export async function GET(request: NextRequest) {
  try {
    const headers = await import('next/headers').then(m => m.headers());
    const authInfo = await verifyWhopUser(headers, request.url);

    if (!authInfo) {
      return NextResponse.json({ role: 'none', isAuthorized: false }, { status: 401 });
    }

    const { userId, companyId } = authInfo;

    if (!companyId) {
      return NextResponse.json({ role: 'none', isAuthorized: false }, { status: 401 });
    }

    // Ensure user exists (companyId is auto-set from Whop)
    const role = await ensureUserExists(userId, companyId);

    // Get user with company membership
    await connectDB();
    const { getUserForCompany } = await import('@/lib/userHelpers');
    const userResult = await getUserForCompany(userId, companyId);

    if (!userResult || !userResult.membership) {
      return NextResponse.json({ role: 'none', isAuthorized: false }, { status: 404 });
    }

    // Users are authorized if they're companyOwner/owner/admin/member (members can create trades and view profile)
    const isAuthorized = role === 'companyOwner' || role === 'owner' || role === 'admin' || role === 'member';

    // Get hideLeaderboardFromMembers and hideCompanyStatsFromMembers settings from company
    let hideLeaderboardFromMembers = false;
    let hideCompanyStatsFromMembers = false;
    if (role === 'member' || role === 'admin') {
      const company = await Company.findOne({ companyId });
      if (company) {
        hideLeaderboardFromMembers = company.hideLeaderboardFromMembers ?? false;
        hideCompanyStatsFromMembers = company.hideCompanyStatsFromMembers ?? false;
      }
    }

    return NextResponse.json({
      role,
      userId,
      companyId: companyId || null,
      isAuthorized,
      hideLeaderboardFromMembers: role === 'member' ? hideLeaderboardFromMembers : undefined,
      hideCompanyStatsFromMembers: (role === 'member' || role === 'admin') ? hideCompanyStatsFromMembers : undefined
    });
  } catch {
    return NextResponse.json({ role: 'none', isAuthorized: false }, { status: 500 });
  }
}

