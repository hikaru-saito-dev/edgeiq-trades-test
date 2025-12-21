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

        for (const user of allUsers) {
            const userDoc = user as any;
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
            const whopUserId = (user as any).whopUserId;
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

            // Check if user already exists in new format
            const existingUser = await User.findOne({ whopUserId });
            const isNewUser = !existingUser;

            // Sort by creation date to get the first one
            userDocs.sort((a, b) => {
                const aDate = (a as any).createdAt || new Date(0);
                const bDate = (b as any).createdAt || new Date(0);
                return aDate.getTime() - bDate.getTime();
            });

            const firstUser = userDocs[0] as any;

            // Prepare base user data
            const baseUserData: any = {
                whopUserId,
                whopUsername: existingUser?.whopUsername || firstUser.whopUsername,
                whopDisplayName: existingUser?.whopDisplayName || firstUser.whopDisplayName,
                whopAvatarUrl: existingUser?.whopAvatarUrl || firstUser.whopAvatarUrl,
                followingDiscordWebhook: existingUser?.followingDiscordWebhook || firstUser.followingDiscordWebhook,
                followingWhopWebhook: existingUser?.followingWhopWebhook || firstUser.followingWhopWebhook,
                companyMemberships: existingUser ? [...existingUser.companyMemberships] : [],
            };

            // Track existing company IDs to avoid duplicates
            const existingCompanyIds = new Set(
                baseUserData.companyMemberships.map((m: any) => m.companyId)
            );

            // Find company owner for each company (user with role 'companyOwner' for that company)
            const companyOwners = new Map<string, string>(); // companyId -> whopUserId

            // Process each company membership
            for (const userDoc of userDocs) {
                const doc = userDoc as any;
                const companyId = doc.companyId;

                if (!companyId) {
                    console.warn(`Skipping user ${doc._id} without companyId`);
                    continue;
                }

                // Skip if membership already exists
                if (existingCompanyIds.has(companyId)) {
                    console.warn(`Skipping duplicate membership for user ${whopUserId} in company ${companyId}`);
                    continue;
                }

                // Track company owner
                if (doc.role === 'companyOwner') {
                    companyOwners.set(companyId, whopUserId);
                }

                // Create or get company
                let company = await Company.findOne({ companyId });
                if (!company) {
                    // Determine company owner - use tracked owner or first user
                    const companyOwnerWhopUserId = companyOwners.get(companyId) || whopUserId;

                    try {
                        company = await Company.create({
                            companyId,
                            companyName: doc.companyName,
                            companyDescription: doc.companyDescription,
                            membershipPlans: doc.membershipPlans || [],
                            hideLeaderboardFromMembers: doc.hideLeaderboardFromMembers ?? false,
                            hideCompanyStatsFromMembers: doc.hideCompanyStatsFromMembers ?? false,
                            companyOwnerWhopUserId,
                        });
                        companyCreatedCount++;
                    } catch (error: any) {
                        // Company might have been created by another process, try to fetch it
                        if (error.code === 11000) {
                            company = await Company.findOne({ companyId });
                            if (!company) {
                                throw error;
                            }
                        } else {
                            throw error;
                        }
                    }
                }

                // Create company membership
                const membership: IUser['companyMemberships'][number] = {
                    companyId,
                    alias: doc.alias || `User ${whopUserId.slice(0, 8)}`,
                    role: (doc.role as UserRole) || 'member',
                    webhooks: (doc.webhooks as Webhook[]) || [],
                    notifyOnSettlement: doc.notifyOnSettlement ?? false,
                    onlyNotifyWinningSettlements: doc.onlyNotifyWinningSettlements ?? false,
                    optIn: doc.optIn ?? true,
                    followOfferEnabled: doc.followOfferEnabled ?? false,
                    followOfferPriceCents: doc.followOfferPriceCents,
                    followOfferNumPlays: doc.followOfferNumPlays,
                    followOfferPlanId: doc.followOfferPlanId,
                    followOfferCheckoutUrl: doc.followOfferCheckoutUrl,
                    joinedAt: doc.createdAt || new Date(),
                };

                baseUserData.companyMemberships.push(membership);
            }

            // Delete old user documents
            for (const userDoc of userDocs) {
                await User.deleteOne({ _id: userDoc._id });
            }

            // Create or update user document
            if (isNewUser) {
                await User.create(baseUserData);
            } else {
                await User.updateOne(
                    { whopUserId },
                    { $set: baseUserData }
                );
            }
            migratedCount++;

            if (migratedCount % 10 === 0) {
                console.log(`Migrated ${migratedCount} users...`);
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

