/**
 * Migration script to transform User collection from old structure to new structure
 * 
 * Old structure: One User document per (whopUserId, companyId) pair
 * New structure: One User document per whopUserId with companyMemberships array
 * 
 * Run with: npx tsx scripts/migrate-user-collection.ts
 */

import { IUser, UserRole, Webhook } from '../src/models/User';

// Load environment variables from .env.local BEFORE any other imports
// Using require to ensure it runs synchronously before ES6 imports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

// Verify environment variables are loaded
if (!process.env.MONGO_URI) {
    console.error('Error: MONGO_URI not found in environment variables');
    console.error('Make sure .env.local exists and contains MONGO_URI');
    process.exit(1);
}

async function migrate() {
    // Use dynamic imports AFTER environment variables are loaded
    const { User } = await import('../src/models/User');
    const { Company } = await import('../src/models/Company');
    const connectDB = (await import('../src/lib/db')).default;

    try {
        await connectDB();
        console.log('Connected to database');

        // Get all users - separate old format (with companyId) from new format (with companyMemberships array)
        const allUsers = await User.find({}).lean();
        console.log(`Found ${allUsers.length} user documents to process`);

        // Separate old format users from new format users
        const oldFormatUsers: typeof allUsers = [];
        const newFormatUsers: typeof allUsers = [];

        // Type for old format user document
        interface OldFormatUser {
            _id: unknown;
            whopUserId?: string;
            companyId?: string;
            companyMemberships?: unknown[];
            [key: string]: unknown;
        }

        for (const user of allUsers) {
            const userDoc = user as OldFormatUser;
            // Check if it's new format: has companyMemberships array (even if empty)
            if (Array.isArray(userDoc.companyMemberships)) {
                newFormatUsers.push(user);
            } else if (userDoc.companyId) {
                // Old format: has companyId field
                oldFormatUsers.push(user);
            } else {
                console.warn('Skipping user with unknown format:', user._id);
            }
        }

        console.log(`- Old format users: ${oldFormatUsers.length}`);
        console.log(`- New format users: ${newFormatUsers.length}`);

        if (oldFormatUsers.length === 0) {
            console.log('No old format users to migrate. Migration complete!');
            process.exit(0);
        }

        // Group old format users by whopUserId
        const usersByWhopUserId = new Map<string, typeof allUsers>();
        for (const user of oldFormatUsers) {
            const userDoc = user as OldFormatUser;
            const whopUserId = userDoc.whopUserId;
            if (!whopUserId) {
                console.warn('Skipping user without whopUserId:', user._id);
                continue;
            }

            if (!usersByWhopUserId.has(whopUserId)) {
                usersByWhopUserId.set(whopUserId, []);
            }
            usersByWhopUserId.get(whopUserId)!.push(user);
        }

        console.log(`Found ${usersByWhopUserId.size} unique whopUserIds`);

        let migratedCount = 0;
        let companyCreatedCount = 0;

        // Process each whopUserId
        for (const [whopUserId, userDocs] of usersByWhopUserId) {
            if (userDocs.length === 0) continue;

            try {
                // Check if user already exists in new format
                const existingUser = await User.findOne({ whopUserId });
                const isNewUser = !existingUser;

                // Sort by creation date to get the first one (oldest)
                userDocs.sort((a, b) => {
                    const aDoc = a as OldFormatUser;
                    const bDoc = b as OldFormatUser;
                    const aDate = (aDoc.createdAt as Date) || new Date(0);
                    const bDate = (bDoc.createdAt as Date) || new Date(0);
                    return aDate.getTime() - bDate.getTime();
                });

                // Helper function to get best value (prefer non-null, non-undefined, most recent)
                const getBestValue = <T>(existing: T | undefined | null, ...candidates: (T | undefined | null)[]): T | undefined => {
                    if (existing !== undefined && existing !== null && existing !== '') {
                        return existing;
                    }
                    for (const candidate of candidates) {
                        if (candidate !== undefined && candidate !== null && candidate !== '') {
                            return candidate;
                        }
                    }
                    return existing ?? undefined;
                };

                // Collect all person-level fields from all old format users
                // Prefer most recent non-empty values
                const allPersonFields: {
                    whopUsername?: string;
                    whopDisplayName?: string;
                    whopAvatarUrl?: string;
                    followingDiscordWebhook?: string;
                    followingWhopWebhook?: string;
                } = {};

                // Sort by updatedAt (most recent first) to get best values
                const sortedByUpdate = [...userDocs].sort((a, b) => {
                    const aDoc = a as OldFormatUser;
                    const bDoc = b as OldFormatUser;
                    const aDate = (aDoc.updatedAt as Date) || (aDoc.createdAt as Date) || new Date(0);
                    const bDate = (bDoc.updatedAt as Date) || (bDoc.createdAt as Date) || new Date(0);
                    return bDate.getTime() - aDate.getTime();
                });

                for (const doc of sortedByUpdate) {
                    const d = doc as OldFormatUser;
                    if (!allPersonFields.whopUsername && d.whopUsername) allPersonFields.whopUsername = d.whopUsername as string;
                    if (!allPersonFields.whopDisplayName && d.whopDisplayName) allPersonFields.whopDisplayName = d.whopDisplayName as string;
                    if (!allPersonFields.whopAvatarUrl && d.whopAvatarUrl) allPersonFields.whopAvatarUrl = d.whopAvatarUrl as string;
                    if (!allPersonFields.followingDiscordWebhook && d.followingDiscordWebhook) allPersonFields.followingDiscordWebhook = d.followingDiscordWebhook as string;
                    if (!allPersonFields.followingWhopWebhook && d.followingWhopWebhook) allPersonFields.followingWhopWebhook = d.followingWhopWebhook as string;
                }

                // Prepare base user data - merge existing with old format data
                interface BaseUserData {
                    whopUserId: string;
                    whopUsername?: string;
                    whopDisplayName?: string;
                    whopAvatarUrl?: string;
                    followingDiscordWebhook?: string;
                    followingWhopWebhook?: string;
                    companyMemberships: IUser['companyMemberships'];
                    activeCompanyId?: string;
                    activeMembership?: IUser['companyMemberships'][number];
                }

                const baseUserData: BaseUserData = {
                    whopUserId,
                    whopUsername: getBestValue(existingUser?.whopUsername, allPersonFields.whopUsername),
                    whopDisplayName: getBestValue(existingUser?.whopDisplayName, allPersonFields.whopDisplayName),
                    whopAvatarUrl: getBestValue(existingUser?.whopAvatarUrl, allPersonFields.whopAvatarUrl),
                    followingDiscordWebhook: getBestValue(existingUser?.followingDiscordWebhook, allPersonFields.followingDiscordWebhook),
                    followingWhopWebhook: getBestValue(existingUser?.followingWhopWebhook, allPersonFields.followingWhopWebhook),
                    companyMemberships: existingUser ? [...existingUser.companyMemberships] : [],
                };

                // Track existing company IDs to avoid duplicates
                const existingCompanyIds = new Set(
                    baseUserData.companyMemberships.map((m) => m.companyId)
                );

                // Find company owner for each company (check ALL old format users for that company)
                const companyOwners = new Map<string, string>(); // companyId -> whopUserId
                interface CompanyData {
                    companyName?: string;
                    companyDescription?: string;
                    membershipPlans: unknown[];
                    hideLeaderboardFromMembers: boolean;
                    hideCompanyStatsFromMembers: boolean;
                }
                const companyDataMap = new Map<string, CompanyData>(); // companyId -> company data from old format

                // First pass: collect company owners and company data
                for (const userDoc of userDocs) {
                    const doc = userDoc as OldFormatUser;
                    const companyId = doc.companyId as string | undefined;

                    if (!companyId) continue;

                    // Track company owner (first companyOwner found wins)
                    if ((doc.role as string) === 'companyOwner' && companyId && !companyOwners.has(companyId)) {
                        companyOwners.set(companyId, whopUserId);
                    }

                    // Collect company data (prefer most complete)
                    if (companyId && !companyDataMap.has(companyId)) {
                        companyDataMap.set(companyId, {
                            companyName: doc.companyName as string | undefined,
                            companyDescription: doc.companyDescription as string | undefined,
                            membershipPlans: (doc.membershipPlans as unknown[]) || [],
                            hideLeaderboardFromMembers: (doc.hideLeaderboardFromMembers as boolean) ?? false,
                            hideCompanyStatsFromMembers: (doc.hideCompanyStatsFromMembers as boolean) ?? false,
                        });
                    } else if (companyId) {
                        const existing = companyDataMap.get(companyId)!;
                        // Merge: prefer non-empty values
                        if (!existing.companyName && doc.companyName) existing.companyName = doc.companyName as string;
                        if (!existing.companyDescription && doc.companyDescription) existing.companyDescription = doc.companyDescription as string;
                        if ((!existing.membershipPlans || existing.membershipPlans.length === 0) && doc.membershipPlans && Array.isArray(doc.membershipPlans) && doc.membershipPlans.length > 0) {
                            existing.membershipPlans = doc.membershipPlans;
                        }
                    }
                }

                // Second pass: process each company membership
                for (const userDoc of userDocs) {
                    const doc = userDoc as OldFormatUser;
                    const companyId = doc.companyId as string | undefined;

                    if (!companyId) {
                        console.warn(`Skipping user ${doc._id} without companyId`);
                        continue;
                    }

                    // Skip if membership already exists
                    if (existingCompanyIds.has(companyId)) {
                        console.warn(`Skipping duplicate membership for user ${whopUserId} in company ${companyId}`);
                        continue;
                    }

                    // Create or update company
                    let company = await Company.findOne({ companyId });
                    const companyData = companyDataMap.get(companyId) || {
                        companyName: undefined,
                        companyDescription: undefined,
                        membershipPlans: [],
                        hideLeaderboardFromMembers: false,
                        hideCompanyStatsFromMembers: false,
                    };
                    const companyOwnerWhopUserId = companyOwners.get(companyId) || whopUserId;

                    if (!company) {
                        try {
                            company = await Company.create({
                                companyId,
                                companyName: companyData.companyName,
                                companyDescription: companyData.companyDescription,
                                membershipPlans: companyData.membershipPlans || [],
                                hideLeaderboardFromMembers: companyData.hideLeaderboardFromMembers ?? false,
                                hideCompanyStatsFromMembers: companyData.hideCompanyStatsFromMembers ?? false,
                                companyOwnerWhopUserId,
                            });
                            companyCreatedCount++;
                        } catch (error: unknown) {
                            // Company might have been created by another process, try to fetch it
                            if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
                                company = await Company.findOne({ companyId });
                                if (!company) {
                                    throw error;
                                }
                            } else {
                                throw error;
                            }
                        }
                    } else {
                        // Update existing company with data from old format (merge, don't overwrite)
                        const updates: Partial<{
                            companyName?: string;
                            companyDescription?: string;
                            membershipPlans: unknown[];
                        }> = {};
                        if (!company.companyName && companyData.companyName) updates.companyName = companyData.companyName;
                        if (!company.companyDescription && companyData.companyDescription) updates.companyDescription = companyData.companyDescription;
                        if ((!company.membershipPlans || company.membershipPlans.length === 0) && companyData.membershipPlans && companyData.membershipPlans.length > 0) {
                            updates.membershipPlans = companyData.membershipPlans;
                        }
                        if (Object.keys(updates).length > 0) {
                            await Company.updateOne({ companyId }, { $set: updates });
                        }
                    }

                    // Create company membership - preserve ALL fields from old format
                    const membership: IUser['companyMemberships'][number] = {
                        companyId: companyId!,
                        alias: (doc.alias as string) || `User ${whopUserId.slice(0, 8)}`,
                        role: (doc.role as UserRole) || 'member',
                        webhooks: (doc.webhooks as Webhook[]) || [],
                        notifyOnSettlement: (doc.notifyOnSettlement as boolean) ?? false,
                        onlyNotifyWinningSettlements: (doc.onlyNotifyWinningSettlements as boolean) ?? false,
                        optIn: (doc.optIn as boolean) ?? true,
                        followOfferEnabled: (doc.followOfferEnabled as boolean) ?? false,
                        followOfferPriceCents: doc.followOfferPriceCents as number | undefined,
                        followOfferNumPlays: doc.followOfferNumPlays as number | undefined,
                        followOfferPlanId: doc.followOfferPlanId as string | undefined,
                        followOfferCheckoutUrl: doc.followOfferCheckoutUrl as string | undefined,
                        joinedAt: (doc.createdAt as Date) || new Date(),
                    };

                    baseUserData.companyMemberships.push(membership);
                }

                // Set activeCompanyId and activeMembership to first company (oldest)
                if (baseUserData.companyMemberships.length > 0) {
                    const firstMembership = baseUserData.companyMemberships[0];
                    baseUserData.activeCompanyId = firstMembership.companyId;
                    baseUserData.activeMembership = firstMembership;
                }

                // Create or update user document (SAVE FIRST, DELETE LATER)
                if (isNewUser) {
                    await User.create(baseUserData);
                } else {
                    // Use $addToSet to merge companyMemberships safely
                    // First, add new memberships
                    for (const membership of baseUserData.companyMemberships) {
                        const existingIndex = existingUser.companyMemberships.findIndex(
                            (m: IUser['companyMemberships'][number]) => m.companyId === membership.companyId
                        );
                        if (existingIndex === -1) {
                            // New membership, add it
                            await User.updateOne(
                                { whopUserId },
                                { $push: { companyMemberships: membership } }
                            );
                        }
                    }
                    // Update person-level fields
                    await User.updateOne(
                        { whopUserId },
                        {
                            $set: {
                                whopUsername: baseUserData.whopUsername,
                                whopDisplayName: baseUserData.whopDisplayName,
                                whopAvatarUrl: baseUserData.whopAvatarUrl,
                                followingDiscordWebhook: baseUserData.followingDiscordWebhook,
                                followingWhopWebhook: baseUserData.followingWhopWebhook,
                                activeCompanyId: baseUserData.activeCompanyId,
                                activeMembership: baseUserData.activeMembership,
                            }
                        }
                    );
                }

                // Only delete old user documents AFTER successful migration
                for (const userDoc of userDocs) {
                    await User.deleteOne({ _id: userDoc._id });
                }

                migratedCount++;

                if (migratedCount % 10 === 0) {
                    console.log(`Migrated ${migratedCount} users...`);
                }
            } catch (error: unknown) {
                console.error(`Error migrating user ${whopUserId}:`, error);
                console.error('Skipping this user and continuing...');
                // Continue with next user instead of failing entire migration
            }
        }

        console.log(`\nMigration complete!`);
        console.log(`- Migrated ${migratedCount} users`);
        console.log(`- Created ${companyCreatedCount} companies`);
        console.log(`- Deleted ${oldFormatUsers.length} old user documents`);

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();

