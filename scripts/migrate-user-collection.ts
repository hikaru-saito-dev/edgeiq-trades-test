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

        // Get all users grouped by whopUserId
        const allUsers = await User.find({}).lean();
        console.log(`Found ${allUsers.length} user documents to migrate`);

        // Group by whopUserId
        const usersByWhopUserId = new Map<string, typeof allUsers>();
        for (const user of allUsers) {
            const whopUserId = (user as unknown as IUser).whopUserId;
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

            // Sort by creation date to get the first one
            userDocs.sort((a, b) => {
                const aDate = (a as unknown as IUser).createdAt || new Date(0);
                const bDate = (b as unknown as IUser).createdAt || new Date(0);
                return aDate.getTime() - bDate.getTime();
            });

            const firstUser = userDocs[0] as unknown as IUser;
            const baseUser = {
                whopUserId,
                whopUsername: firstUser.whopUsername,
                whopDisplayName: firstUser.whopDisplayName,
                whopAvatarUrl: firstUser.whopAvatarUrl,
                followingDiscordWebhook: firstUser.followingDiscordWebhook,
                followingWhopWebhook: firstUser.followingWhopWebhook,
                companyMemberships: [] as IUser['companyMemberships'],
            };

            // Process each company membership
            for (const userDoc of userDocs) {
                const doc = userDoc as unknown as IUser & { companyId?: string; companyName?: string; companyDescription?: string; membershipPlans?: unknown[]; hideLeaderboardFromMembers?: boolean; hideCompanyStatsFromMembers?: boolean; alias?: string; role?: string; webhooks?: unknown[]; notifyOnSettlement?: boolean; onlyNotifyWinningSettlements?: boolean; optIn?: boolean; followOfferEnabled?: boolean; followOfferPriceCents?: number; followOfferNumPlays?: number; followOfferPlanId?: string; followOfferCheckoutUrl?: string };
                const companyId = doc.companyId;

                if (!companyId) {
                    console.warn(`Skipping user ${doc._id} without companyId`);
                    continue;
                }

                // Create or get company
                let company = await Company.findOne({ companyId });
                if (!company) {
                    // Determine company owner
                    const companyOwnerWhopUserId = doc.role === 'companyOwner' ? whopUserId : firstUser.whopUserId;

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

                baseUser.companyMemberships.push(membership);
            }

            // Delete old user documents
            for (const userDoc of userDocs) {
                await User.deleteOne({ _id: userDoc._id });
            }

            // Create new merged user document
            await User.create(baseUser);
            migratedCount++;

            if (migratedCount % 10 === 0) {
                console.log(`Migrated ${migratedCount} users...`);
            }
        }

        console.log(`\nMigration complete!`);
        console.log(`- Migrated ${migratedCount} users`);
        console.log(`- Created ${companyCreatedCount} companies`);
        console.log(`- Deleted ${allUsers.length} old user documents`);

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();

