import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import { decrypt } from '@/lib/encryption';

export const runtime = 'nodejs';

const SNAPTRADE_CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;
const SNAPTRADE_CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID;

/**
 * POST /api/snaptrade/complete
 * Manually complete connection after OAuth (if callback wasn't triggered)
 * This can be called from the frontend after OAuth completes
 */
export async function POST(request: NextRequest) {
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

        // Find most recent inactive connection (created in last 10 minutes)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const connection = await BrokerConnection.findOne({
            userId: user._id,
            isActive: false,
            brokerType: 'snaptrade',
            createdAt: { $gte: tenMinutesAgo },
        }).sort({ createdAt: -1 });

        if (!connection) {
            return NextResponse.json(
                { error: 'No pending connection found. Please try connecting again.' },
                { status: 404 }
            );
        }

        // Initialize SnapTrade client
        const snaptrade = new Snaptrade({
            consumerKey: SNAPTRADE_CONSUMER_KEY,
            clientId: SNAPTRADE_CLIENT_ID,
        });

        // Decrypt user secret
        const userSecret = decrypt(connection.snaptradeUserSecret);

        // Get user's accounts
        const accountsResponse = await snaptrade.accountInformation.listUserAccounts({
            userId: connection.snaptradeUserId,
            userSecret,
        });

        if (!accountsResponse.data || accountsResponse.data.length === 0) {
            return NextResponse.json(
                { error: 'No accounts found. Please complete the connection in SnapTrade first.' },
                { status: 400 }
            );
        }

        // Get authorizations to find broker info
        const authorizationsResponse = await snaptrade.connections.listBrokerageAuthorizations({
            userId: connection.snaptradeUserId,
            userSecret,
        });

        // Use first account
        const firstAccount = accountsResponse.data[0];
        const authorization = authorizationsResponse.data?.[0];

        if (!firstAccount || !firstAccount.id) {
            return NextResponse.json(
                { error: 'Invalid account data' },
                { status: 500 }
            );
        }

        // Update connection with account info
        connection.accountId = firstAccount.id;
        connection.authorizationId = authorization?.id || firstAccount.brokerage_authorization;
        connection.isActive = true;
        connection.brokerName = authorization?.brokerage?.name || firstAccount.institution_name || 'Unknown';
        connection.accountName = firstAccount.name || firstAccount.number || 'Unknown';
        connection.accountNumber = firstAccount.number || firstAccount.id;
        connection.lastSyncedAt = new Date();

        // Get buying power
        try {
            const balanceResponse = await snaptrade.accountInformation.getUserAccountBalance({
                userId: connection.snaptradeUserId,
                userSecret,
                accountId: firstAccount.id,
            });

            const balances = balanceResponse.data || [];
            const balance = balances.find(b => b.currency?.code === 'USD') || balances[0];
            if (balance) {
                connection.buyingPower = balance.buying_power || balance.cash || undefined;
            }
        } catch (error) {
            console.warn('Failed to fetch buying power:', error);
        }

        await connection.save();

        return NextResponse.json({
            success: true,
            connection: {
                id: connection._id.toString(),
                brokerName: connection.brokerName,
                accountName: connection.accountName,
                accountNumber: connection.accountNumber,
                buyingPower: connection.buyingPower,
            },
        });
    } catch (error) {
        console.error('SnapTrade complete error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to complete connection' },
            { status: 500 }
        );
    }
}

