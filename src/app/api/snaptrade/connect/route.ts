import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import { encrypt, decrypt } from '@/lib/encryption';

export const runtime = 'nodejs';

const SNAPTRADE_CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;
const SNAPTRADE_CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID;

/**
 * POST /api/snaptrade/connect
 * Initiate SnapTrade connection - creates user and returns redirect URI
 */
export async function POST() {
    try {
        await connectDB();
        const headers = await import('next/headers').then(m => m.headers());

        const userId = headers.get('x-user-id');
        const companyId = headers.get('x-company-id');

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_CLIENT_ID) {
            return NextResponse.json(
                { error: 'SnapTrade credentials not configured' },
                { status: 500 }
            );
        }

        // Check for encryption key
        if (!process.env.ENCRYPTION_KEY) {
            return NextResponse.json(
                {
                    error: 'ENCRYPTION_KEY environment variable is not set. ' +
                        'Please add it to your .env.local file. ' +
                        'Generate a key by running: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
                },
                { status: 500 }
            );
        }

        // Find user with company membership
        const { getUserForCompany } = await import('@/lib/userHelpers');
        if (!companyId) {
            return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
        }
        const userResult = await getUserForCompany(userId, companyId);
        if (!userResult || !userResult.membership) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const { user } = userResult;

        // Initialize SnapTrade client
        const snaptrade = new Snaptrade({
            consumerKey: SNAPTRADE_CONSUMER_KEY,
            clientId: SNAPTRADE_CLIENT_ID,
        });

        // Check if connection already exists for this user and brokerType
        // We can only have ONE connection per user per brokerType (due to unique index)
        const existingConnection = await BrokerConnection.findOne({
            userId: user._id,
            brokerType: 'snaptrade',
        });

        let snaptradeUserId: string;
        let userSecret: string;
        let encryptedSecret: string;

        if (existingConnection && existingConnection.snaptradeUserId) {
            // Reuse existing connection and SnapTrade user
            snaptradeUserId = existingConnection.snaptradeUserId;

            // Try to decrypt existing secret, if it fails, we'll need to re-register
            try {
                const existingSecret = decrypt(existingConnection.snaptradeUserSecret);
                userSecret = existingSecret;
                encryptedSecret = existingConnection.snaptradeUserSecret; // Already encrypted
            } catch {
                // Secret decryption failed, need to re-register
                // Generate new SnapTrade user ID
                snaptradeUserId = `user_${user.whopUserId}_${Date.now()}`;

                // Register new user with SnapTrade
                const registerResponse = await snaptrade.authentication.registerSnapTradeUser({
                    userId: snaptradeUserId,
                });

                if (!registerResponse.data || !registerResponse.data.userSecret) {
                    return NextResponse.json(
                        { error: 'Failed to register with SnapTrade' },
                        { status: 500 }
                    );
                }

                userSecret = registerResponse.data.userSecret;
                encryptedSecret = encrypt(userSecret);
            }
        } else {
            // No existing connection, create new SnapTrade user
            // Generate unique SnapTrade user ID
            snaptradeUserId = `user_${user.whopUserId}_${Date.now()}`;

            // Register user with SnapTrade
            const registerResponse = await snaptrade.authentication.registerSnapTradeUser({
                userId: snaptradeUserId,
            });

            if (!registerResponse.data || !registerResponse.data.userSecret) {
                return NextResponse.json(
                    { error: 'Failed to register with SnapTrade' },
                    { status: 500 }
                );
            }

            userSecret = registerResponse.data.userSecret;
            encryptedSecret = encrypt(userSecret);
        }

        // Use findOneAndUpdate with upsert to avoid duplicate key errors
        // This will update if exists, create if not
        const connection = await BrokerConnection.findOneAndUpdate(
            {
                userId: user._id,
                brokerType: 'snaptrade',
            },
            {
                $set: {
                    whopUserId: user.whopUserId,
                    companyId: companyId || undefined,
                    snaptradeUserId,
                    snaptradeUserSecret: encryptedSecret,
                    isActive: false, // Will be activated after OAuth completes
                    lastSyncedAt: new Date(),
                },
                $setOnInsert: {
                    connectedAt: new Date(),
                },
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
            }
        );

        // Get login redirect URI with trading permissions enabled
        // connectionType: 'trade' is REQUIRED to enable trading (default is 'read' which is read-only)
        const loginResponse = await snaptrade.authentication.loginSnapTradeUser({
            userId: snaptradeUserId,
            userSecret,
            connectionType: 'trade', // Enable trading permissions (not just read-only)
            reconnect: existingConnection?.authorizationId || undefined, // Reconnect if existing connection
        });

        if (!loginResponse.data || !('redirectURI' in loginResponse.data)) {
            return NextResponse.json(
                { error: 'Failed to get redirect URI' },
                { status: 500 }
            );
        }

        const redirectURI = loginResponse.data.redirectURI;

        // Append connectionId and userId to the redirect URI so callback can find the connection
        // SnapTrade will redirect back to our callback URL after OAuth
        const callbackUrl = new URL('/api/snaptrade/callback', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
        callbackUrl.searchParams.set('connectionId', connection._id.toString());
        callbackUrl.searchParams.set('userId', user.whopUserId);

        // If SnapTrade allows custom redirect_uri, we can use our callback URL
        // Otherwise, we'll need to handle it differently
        // For now, append our callback info to SnapTrade's redirect URI as a fragment or query param
        // Note: SnapTrade may not allow modifying the redirectURI, so we'll store the connectionId in session/cookie
        // or find it by userId in the callback

        return NextResponse.json({
            success: true,
            redirectURI,
            connectionId: connection._id.toString(),
            userId: user.whopUserId,
        });
    } catch (error) {
        console.error('SnapTrade connect error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to connect' },
            { status: 500 }
        );
    }
}

