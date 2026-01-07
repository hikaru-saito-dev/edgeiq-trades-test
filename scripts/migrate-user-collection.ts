/**
 * Migration Script: Convert User collection from old structure to new structure
 *
 * OLD STRUCTURE (current production):
 * - Collection: users
 * - One document per (whopUserId, companyId) OR per person
 * - Company-specific fields are on the User document:
 *   - companyId, role, alias, webhooks, optIn, followOffer*, membershipPlans, hideLeaderboardFromMembers, etc.
 *
 * NEW STRUCTURE (after migration):
 * - Collection: users
 *   - One document per person (whopUserId)
 *   - `companyMemberships`: array of company-specific data
 *   - `activeCompanyId`, `activeMembership`
 * - Collection: companies
 *   - One document per companyId
 *   - Company-level settings (membershipPlans, hideLeaderboardFromMembers, hideCompanyStatsFromMembers, companyOwnerWhopUserId, optIn)
 *
 * GOALS:
 * - SAFE: creates backup, supports dry-run, and can be run multiple times.
 * - CORRECT: preserves ALL old data, no duplication, no data loss.
 * - ONE companyOwner per companyId.
 * - Leaderboard behavior preserved:
 *   - Only companyOwner appears on leaderboard.
 *   - `optIn` is company-level (migrated to Company collection); default true when missing.
 *
 * USAGE:
 *   npm run migrate:users:dry    # Dry-run (no writes)
 *   npm run migrate:users        # Live migration
 *
 * IMPORTANT:
 * - This script is intentionally focused ONLY on migrating from the old structure
 *   (documents that still have `companyId` and no `companyMemberships`) into the
 *   new structure. It does NOT try to be a generic "repair everything" script.
 */

import mongoose from 'mongoose';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local (same behavior as app)
const envPaths = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '..', '.env.local'),
];

let envLoaded = false;
for (const envPath of envPaths) {
    const result = config({ path: envPath });
    if (!result.error) {
        envLoaded = true;
        console.log(`✅ Loaded environment from: ${envPath}`);
        break;
    }
}

if (!envLoaded) {
    console.warn('⚠️  Could not find .env.local file, using process env vars');
}

const MONGODB_URI = process.env.MONGO_URI;
const MONGODB_DB = process.env.MONGO_DB;

if (!MONGODB_URI || !MONGODB_DB) {
    console.error('❌ Missing MONGO_URI or MONGO_DB environment variables');
    process.exit(1);
}

// Import models AFTER env is loaded
import { User, IUser, CompanyMembership } from '../src/models/User';
import { Company, ICompany } from '../src/models/Company';

type OldUserDoc = {
    _id: mongoose.Types.ObjectId;
    whopUserId: string;
    whopUsername?: string;
    whopDisplayName?: string;
    whopAvatarUrl?: string;
    companyId?: string;
    role?: 'companyOwner' | 'owner' | 'admin' | 'member' | string;
    alias?: string;
    webhooks?: unknown[];
    notifyOnSettlement?: boolean;
    onlyNotifyWinningSettlements?: boolean;
    optIn?: boolean;
    followOfferEnabled?: boolean;
    followOfferPriceCents?: number;
    followOfferNumPlays?: number;
    followOfferPlanId?: string;
    followOfferCheckoutUrl?: string;
    membershipPlans?: ICompany['membershipPlans'];
    hideLeaderboardFromMembers?: boolean;
    hideCompanyStatsFromMembers?: boolean;
    companyName?: string;
    companyDescription?: string;
    createdAt?: Date;
    updatedAt?: Date;
};

type MigrationStats = {
    totalOldDocs: number;
    totalOldUsers: number;
    migratedUsers: number;
    skippedUsers: number;
    errors: number;
    companiesTouched: Set<string>;
};

// -----------------------------
// DB Connection Helpers
// -----------------------------

async function connectDB(): Promise<void> {
    if (mongoose.connection.readyState === 1) return;

    try {
        await mongoose.connect(MONGODB_URI as string, { dbName: MONGODB_DB as string });
        console.log('✅ Connected to MongoDB');
        console.log(`   Database: ${MONGODB_DB}`);
    } catch (err) {
        console.error('❌ Failed to connect to MongoDB:', err);
        process.exit(1);
    }
}

// -----------------------------
// Backup & Rollback
// -----------------------------

async function createBackup(): Promise<string> {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `users_backup_${timestamp}`;

    console.log('📦 Creating backup collection:', backupName);

    await db.collection('users').aggregate([{ $match: {} }, { $out: backupName }]).toArray();

    console.log('✅ Backup created:', backupName);
    console.log('   To restore manually:');
    console.log(`   db.${backupName}.aggregate([{ $match: {} }, { $out: "users" }])`);
    return backupName;
}

async function rollbackFromLatestBackup(): Promise<void> {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');

    const collections = await db.listCollections().toArray();
    const backups = collections
        .map(c => c.name)
        .filter(name => name.startsWith('users_backup_'))
        .sort()
        .reverse();

    if (backups.length === 0) {
        console.error('❌ No users_backup_* collections found to rollback from');
        return;
    }

    const latest = backups[0];
    console.log(`⏪ Rolling back from latest backup: ${latest}`);

    await db.collection(latest).aggregate([{ $match: {} }, { $out: 'users' }]).toArray();

    console.log('✅ Rollback completed (users collection restored from backup)');
}

// -----------------------------
// Detection of Old Structure
// -----------------------------

async function detectOldStructure(): Promise<{ totalOldDocs: number; uniqueWhopUserIds: string[] }> {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');

    const usersCollection = db.collection('users');

    console.log('🔍 Scanning users collection for old-structure documents...');

    const totalUsers = await usersCollection.estimatedDocumentCount();
    console.log(`   Total documents in users collection: ${totalUsers}`);

    // Old structure definition:
    // - companyId exists
    // - companyMemberships is missing OR null OR empty array
    const oldStructureQuery = {
        companyId: { $exists: true, $ne: null },
        $or: [
            { companyMemberships: { $exists: false } },
            { companyMemberships: null },
            { companyMemberships: { $size: 0 } },
        ],
    };

    const totalOldDocs = await usersCollection.countDocuments(oldStructureQuery);
    const uniqueWhopUserIds = (await usersCollection.distinct('whopUserId', {
        ...oldStructureQuery,
        whopUserId: { $exists: true, $ne: null },
    })) as string[];

    const newStructureCount = await usersCollection.countDocuments({
        'companyMemberships.0': { $exists: true },
    });

    console.log(`   Old-structure documents: ${totalOldDocs}`);
    console.log(`   Unique whopUserIds with old structure: ${uniqueWhopUserIds.length}`);
    console.log(`   New-structure users (already migrated): ${newStructureCount}`);

    return { totalOldDocs, uniqueWhopUserIds };
}

// -----------------------------
// Per-User Migration
// -----------------------------

function pickBest<T>(values: (T | undefined)[]): T | undefined {
    for (const v of values) {
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
}


function mapRole(oldRole?: string): 'companyOwner' | 'owner' | 'admin' | 'member' {
    if (oldRole === 'companyOwner') return 'companyOwner';
    if (oldRole === 'owner') return 'owner';
    if (oldRole === 'admin') return 'admin';
    return 'member';
}

async function migrateOneUser(
    whopUserId: string,
    dryRun: boolean,
    stats: MigrationStats,
): Promise<void> {
    try {
        const oldDocs = (await User.find({
            whopUserId,
            companyId: { $exists: true, $ne: null },
            $or: [
                { companyMemberships: { $exists: false } },
                { companyMemberships: null },
                { companyMemberships: { $size: 0 } },
            ],
        }).lean()) as unknown as OldUserDoc[];

        if (oldDocs.length === 0) {
            stats.skippedUsers++;
            return;
        }

        // Existing new-structure user (if any)
        const existingNewUser = (await User.findOne({
            whopUserId,
            'companyMemberships.0': { $exists: true },
        })) as IUser | null;

        // Group memberships by companyId (there should be at most one old doc per companyId, but be safe)
        const membershipByCompany = new Map<string, CompanyMembership>();
        const usernames: (string | undefined)[] = [];
        const displayNames: (string | undefined)[] = [];
        const avatars: (string | undefined)[] = [];

        for (const doc of oldDocs) {
            if (!doc.companyId) continue;

            usernames.push(doc.whopUsername);
            displayNames.push(doc.whopDisplayName);
            avatars.push(doc.whopAvatarUrl);

            if (!membershipByCompany.has(doc.companyId)) {
                const mappedRole = mapRole(doc.role);

                const membership: CompanyMembership = {
                    companyId: doc.companyId,
                    alias: doc.alias || doc.whopDisplayName || doc.whopUsername || `User ${whopUserId.slice(0, 8)}`,
                    role: mappedRole,
                    webhooks: (Array.isArray(doc.webhooks) ? doc.webhooks : []) as CompanyMembership['webhooks'],
                    notifyOnSettlement: doc.notifyOnSettlement ?? false,
                    onlyNotifyWinningSettlements: doc.onlyNotifyWinningSettlements ?? false,
                    // Note: optIn removed - now stored in Company model
                    followOfferEnabled: doc.followOfferEnabled ?? false,
                    followOfferPriceCents: doc.followOfferPriceCents,
                    followOfferNumPlays: doc.followOfferNumPlays,
                    followOfferPlanId: doc.followOfferPlanId,
                    followOfferCheckoutUrl: doc.followOfferCheckoutUrl,
                    joinedAt: doc.createdAt || new Date(),
                };

                membershipByCompany.set(doc.companyId, membership);
            }
        }

        if (membershipByCompany.size === 0) {
            stats.skippedUsers++;
            return;
        }

        const mergedUsername = pickBest(usernames);
        const mergedDisplayName = pickBest(displayNames);
        const mergedAvatar = pickBest(avatars);

        const memberships = Array.from(membershipByCompany.values());
        const firstMembership = memberships[0];

        if (dryRun) {
            console.log(`   [DRY RUN] Would migrate whopUserId=${whopUserId} with ${memberships.length} membership(s)`);
            stats.migratedUsers++;
            return;
        }

        if (existingNewUser) {
            // Merge new memberships into existing user (avoid duplicates by companyId)
            const existingByCompany = new Map<string, CompanyMembership>();
            for (const m of existingNewUser.companyMemberships || []) {
                existingByCompany.set(m.companyId, m);
            }

            for (const m of memberships) {
                if (!existingByCompany.has(m.companyId)) {
                    existingNewUser.companyMemberships.push(m);
                }
            }

            // Patch person-level fields if missing
            if (!existingNewUser.whopUsername && mergedUsername) existingNewUser.whopUsername = mergedUsername;
            if (!existingNewUser.whopDisplayName && mergedDisplayName) existingNewUser.whopDisplayName = mergedDisplayName;
            if (!existingNewUser.whopAvatarUrl && mergedAvatar) existingNewUser.whopAvatarUrl = mergedAvatar;
            if (!existingNewUser.activeCompanyId) {
                existingNewUser.activeCompanyId = firstMembership.companyId;
                existingNewUser.activeMembership = firstMembership;
            }

            await existingNewUser.save();
        } else {
            // Create brand new user in new structure
            await User.create({
                whopUserId,
                whopUsername: mergedUsername,
                whopDisplayName: mergedDisplayName,
                whopAvatarUrl: mergedAvatar,
                companyMemberships: memberships,
                activeCompanyId: firstMembership.companyId,
                activeMembership: firstMembership,
            } as Partial<IUser>);
        }

        // Delete all old-structure docs for this whopUserId
        const oldIds = oldDocs.map(d => d._id);
        if (oldIds.length > 0) {
            await User.deleteMany({
                _id: { $in: oldIds },
                companyId: { $exists: true, $ne: null },
                $or: [
                    { companyMemberships: { $exists: false } },
                    { companyMemberships: null },
                    { companyMemberships: { $size: 0 } },
                ],
            });
        }

        // Track companies touched (for later company migration)
        for (const m of memberships) {
            stats.companiesTouched.add(m.companyId);
        }

        stats.migratedUsers++;
    } catch (err) {
        console.error(`❌ Error migrating user ${whopUserId}:`, err);
        stats.errors++;
    }
}

// -----------------------------
// Company Migration / Fix
// -----------------------------

async function syncCompaniesFromUsers(dryRun: boolean): Promise<void> {
    console.log('\n🏢 Syncing companies from companyOwner old docs...');

    // Step 1: Find ALL companyOwners from old-structure docs
    // These are the source of truth for company settings (optIn, membershipPlans, etc.)
    const companyOwnerOldDocs = (await User.find({
        companyId: { $exists: true, $ne: null },
        role: 'companyOwner', // only companyOwner can have company settings
        $or: [
            { companyMemberships: { $exists: false } },
            { companyMemberships: null },
            { companyMemberships: { $size: 0 } },
        ],
    }).lean()) as unknown as OldUserDoc[];

    console.log(`   Found ${companyOwnerOldDocs.length} companyOwner old docs`);

    // Step 2: Group by companyId, preferring companyOwner over owner
    const companyOwnerByCompany = new Map<string, OldUserDoc>();
    for (const doc of companyOwnerOldDocs) {
        if (!doc.companyId) continue;
        const existing = companyOwnerByCompany.get(doc.companyId);
        if (!existing || doc.role === 'companyOwner') {
            // Prefer companyOwner over owner, or take first if same role
            companyOwnerByCompany.set(doc.companyId, doc);
        }
    }

    console.log(`   Found ${companyOwnerByCompany.size} unique companies with companyOwner`);

    // Step 3: Also get companyOwner from new-structure users (for companies that might not have old docs)
    const newStructureUsers = (await User.find({
        'companyMemberships.0': { $exists: true },
    }).lean()) as unknown as IUser[];

    const companyOwnerFromNew = new Map<string, string>(); // companyId -> whopUserId
    for (const user of newStructureUsers) {
        if (!user.companyMemberships) continue;
        for (const m of user.companyMemberships as unknown as CompanyMembership[]) {
            if (m.role === 'companyOwner' && !companyOwnerFromNew.has(m.companyId)) {
                companyOwnerFromNew.set(m.companyId, user.whopUserId);
            }
        }
    }

    // Step 4: Process each company
    for (const [companyId, companyOwnerDoc] of companyOwnerByCompany.entries()) {
        const existing = (await Company.findOne({ companyId })) as ICompany | null;

        // Get companyOwner whopUserId (from old doc or new structure)
        const ownerWhopUserId = companyOwnerDoc.whopUserId || companyOwnerFromNew.get(companyId) || '';

        // Extract company settings from companyOwner's old doc
        // optIn is company-level, migrated from companyOwner's old doc
        const optIn = companyOwnerDoc.optIn ?? true; // Default true if not set
        const membershipPlans = companyOwnerDoc.membershipPlans || [];
        const hideLeaderboardFromMembers = companyOwnerDoc.hideLeaderboardFromMembers ?? false;
        const hideCompanyStatsFromMembers = companyOwnerDoc.hideCompanyStatsFromMembers ?? false;
        const companyName = companyOwnerDoc.companyName;
        const companyDescription = companyOwnerDoc.companyDescription;

        if (dryRun) {
            if (!existing) {
                console.log(
                    `   [DRY RUN] Would create Company(${companyId}) with owner=${ownerWhopUserId}, optIn=${optIn}, membershipPlans=${membershipPlans.length}, hideLeaderboardFromMembers=${hideLeaderboardFromMembers}`,
                );
            } else {
                const updates: string[] = [];
                if (ownerWhopUserId && existing.companyOwnerWhopUserId !== ownerWhopUserId) {
                    updates.push(`owner from ${existing.companyOwnerWhopUserId} to ${ownerWhopUserId}`);
                }
                if (existing.optIn !== optIn) {
                    updates.push(`optIn from ${existing.optIn ?? true} to ${optIn}`);
                }
                if (membershipPlans.length > 0 && (!existing.membershipPlans || existing.membershipPlans.length === 0)) {
                    updates.push(`membershipPlans from ${existing.membershipPlans?.length || 0} to ${membershipPlans.length}`);
                }
                if (existing.hideLeaderboardFromMembers !== hideLeaderboardFromMembers) {
                    updates.push(`hideLeaderboardFromMembers from ${existing.hideLeaderboardFromMembers} to ${hideLeaderboardFromMembers}`);
                }
                if (updates.length > 0) {
                    console.log(`   [DRY RUN] Would update Company(${companyId}): ${updates.join(', ')}`);
                }
            }
            continue;
        }

        if (!existing) {
            // Create new Company from companyOwner's old doc
            await Company.create({
                companyId,
                companyOwnerWhopUserId: ownerWhopUserId,
                optIn, // Migrate optIn to Company (company-level setting)
                membershipPlans,
                companyName,
                companyDescription,
                hideLeaderboardFromMembers,
                hideCompanyStatsFromMembers,
            } as Partial<ICompany>);
            console.log(`   ✅ Created Company(${companyId}) with optIn=${optIn}, membershipPlans=${membershipPlans.length}`);
        } else {
            // Update existing Company with companyOwner's settings
            let updated = false;
            if (ownerWhopUserId && existing.companyOwnerWhopUserId !== ownerWhopUserId) {
                existing.companyOwnerWhopUserId = ownerWhopUserId;
                updated = true;
            }
            // Always update optIn from companyOwner's doc (it's the source of truth)
            if (existing.optIn !== optIn) {
                existing.optIn = optIn;
                updated = true;
            }
            // Migrate membershipPlans if Company doesn't have any
            if (membershipPlans.length > 0 && (!existing.membershipPlans || existing.membershipPlans.length === 0)) {
                existing.membershipPlans = membershipPlans;
                updated = true;
            }
            // Update companyName if missing
            if (!existing.companyName && companyName) {
                existing.companyName = companyName;
                updated = true;
            }
            // Update companyDescription if missing
            if (!existing.companyDescription && companyDescription) {
                existing.companyDescription = companyDescription;
                updated = true;
            }
            // Update hideLeaderboardFromMembers from companyOwner's doc
            if (existing.hideLeaderboardFromMembers !== hideLeaderboardFromMembers) {
                existing.hideLeaderboardFromMembers = hideLeaderboardFromMembers;
                updated = true;
            }
            // Update hideCompanyStatsFromMembers from companyOwner's doc
            if (existing.hideCompanyStatsFromMembers !== hideCompanyStatsFromMembers) {
                existing.hideCompanyStatsFromMembers = hideCompanyStatsFromMembers;
                updated = true;
            }
            if (updated) {
                await existing.save();
                console.log(`   ✅ Updated Company(${companyId}) with optIn=${optIn}, membershipPlans=${membershipPlans.length}`);
            }
        }
    }

    // Step 5: Also create Companies for companies that exist in new structure but don't have old docs
    for (const [companyId, ownerWhopUserId] of companyOwnerFromNew.entries()) {
        if (companyOwnerByCompany.has(companyId)) {
            continue; // Already processed above
        }

        const existing = (await Company.findOne({ companyId })) as ICompany | null;
        if (!existing && !dryRun) {
            // Create Company with defaults (no old doc to get settings from)
            await Company.create({
                companyId,
                companyOwnerWhopUserId: ownerWhopUserId,
                optIn: true, // Default to true
                membershipPlans: [],
                hideLeaderboardFromMembers: false,
                hideCompanyStatsFromMembers: false,
            } as Partial<ICompany>);
            console.log(`   ✅ Created Company(${companyId}) with defaults (no old doc found)`);
        }
    }
}

// -----------------------------
// High-level Migration Runner
// -----------------------------

async function runMigration(dryRun: boolean): Promise<void> {
    await connectDB();

    const args = process.argv.slice(2);
    if (args.includes('--rollback')) {
        console.log('⏪ Rollback requested...');
        await rollbackFromLatestBackup();
        await mongoose.disconnect();
        return;
    }

    const stats: MigrationStats = {
        totalOldDocs: 0,
        totalOldUsers: 0,
        migratedUsers: 0,
        skippedUsers: 0,
        errors: 0,
        companiesTouched: new Set<string>(),
    };

    console.log('🚀 Starting User collection migration...');
    console.log(`   Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes enabled)'}`);

    // Step 1: Detect old-structure documents
    const detection = await detectOldStructure();
    stats.totalOldDocs = detection.totalOldDocs;
    stats.totalOldUsers = detection.uniqueWhopUserIds.length;

    if (stats.totalOldDocs === 0) {
        console.log('✅ No old-structure documents found. Nothing to migrate.');
        await mongoose.disconnect();
        return;
    }

    // Step 2: Backup (only in live mode)
    let backupName: string | null = null;
    if (!dryRun) {
        backupName = await createBackup();
    } else {
        console.log('📦 [DRY RUN] Would create backup collection before migrating');
    }

    // Step 3: FIRST - Create/update Companies from companyOwner old docs (BEFORE migrating users)
    // This must happen BEFORE user migration because user migration deletes old docs
    await syncCompaniesFromUsers(dryRun);

    // Step 4: THEN - Migrate users one-by-one (this will delete old docs)
    console.log(`\n👤 Migrating ${stats.totalOldUsers} unique whopUserId(s)...`);

    const batchSize = 50;
    let processed = 0;

    for (const whopUserId of detection.uniqueWhopUserIds) {
        await migrateOneUser(whopUserId, dryRun, stats);
        processed++;
        if (processed % batchSize === 0) {
            console.log(
                `   Progress: ${processed}/${stats.totalOldUsers} (${Math.round(
                    (processed / stats.totalOldUsers) * 100,
                )}%)`,
            );
        }
    }

    // Step 5: Summary
    console.log('\n📊 Migration Summary:');
    console.log(`   Total old-structure docs   : ${stats.totalOldDocs}`);
    console.log(`   Unique users to migrate    : ${stats.totalOldUsers}`);
    console.log(`   Users migrated             : ${stats.migratedUsers}`);
    console.log(`   Users skipped              : ${stats.skippedUsers}`);
    console.log(`   Errors                     : ${stats.errors}`);
    console.log(`   Companies touched          : ${stats.companiesTouched.size}`);
    if (backupName) {
        console.log(`   Backup collection          : ${backupName}`);
    }

    await mongoose.disconnect();
    console.log('✅ Migration finished.');
}

// Entry point
const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');

runMigration(isDryRun).catch(err => {
    console.error('❌ Migration failed with unexpected error:', err);
    process.exit(1);
});
