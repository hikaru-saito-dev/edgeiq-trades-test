import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import { encrypt } from '@/lib/encryption';
import { randomUUID } from 'node:crypto';

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

        // Find user
        const user = await User.findOne({ whopUserId: userId, companyId: companyId });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Initialize SnapTrade client
        const snaptrade = new Snaptrade({
            consumerKey: SNAPTRADE_CONSUMER_KEY,
            clientId: SNAPTRADE_CLIENT_ID,
        });

        // Generate unique SnapTrade user ID (use UUID)
        const snaptradeUserId = `user_${user._id.toString()}_${randomUUID()}`;

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

        const userSecret = registerResponse.data.userSecret;

        // Encrypt and store the connection (temporary, will be finalized after OAuth)
        const encryptedSecret = encrypt(userSecret);

        // Check if connection already exists
        let connection = await BrokerConnection.findOne({
            userId: user._id,
            snaptradeUserId,
            isActive: true,
        });

        if (connection) {
            // Update existing connection
            connection.snaptradeUserSecret = encryptedSecret;
            await connection.save();
        } else {
            // Create new connection
            connection = await BrokerConnection.create({
                userId: user._id,
                whopUserId: user.whopUserId,
                companyId: user.companyId,
                brokerType: 'snaptrade',
                isActive: false, // Will be activated after OAuth completes
                snaptradeUserId,
                snaptradeUserSecret: encryptedSecret,
                connectedAt: new Date(),
            });
        }

        // Get login redirect URI
        const loginResponse = await snaptrade.authentication.loginSnapTradeUser({
            userId: snaptradeUserId,
            userSecret,
        });

        if (!loginResponse.data || !('redirectURI' in loginResponse.data)) {
            return NextResponse.json(
                { error: 'Failed to get redirect URI' },
                { status: 500 }
            );
        }

        const redirectURI = loginResponse.data.redirectURI;

        return NextResponse.json({
            success: true,
            redirectURI,
            connectionId: connection._id.toString(),
        });
    } catch (error) {
        console.error('SnapTrade connect error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to connect' },
            { status: 500 }
        );
    }
}

