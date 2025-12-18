import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import { decrypt } from '@/lib/encryption';

export const runtime = 'nodejs';

const SNAPTRADE_CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;
const SNAPTRADE_CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID;

/**
 * GET /api/snaptrade/accounts
 * Get all connected SnapTrade accounts for the user
 */
export async function GET() {
    try {
        await connectDB();
        const headers = await import('next/headers').then(m => m.headers());

        const userId = headers.get('x-user-id');
        const companyId = headers.get('x-company-id');

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Find user
        const user = await User.findOne({ whopUserId: userId, companyId: companyId });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Get all active connections
        const connections = await BrokerConnection.find({
            userId: user._id,
            isActive: true,
            brokerType: 'snaptrade',
        });

        if (!SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_CLIENT_ID) {
            // Return cached account info if available
            return NextResponse.json({
                success: true,
                accounts: connections.map(conn => ({
                    id: conn._id.toString(),
                    brokerName: conn.brokerName || 'Unknown',
                    accountName: conn.accountName || 'Unknown',
                    accountNumber: conn.accountNumber,
                    buyingPower: conn.buyingPower,
                })),
            });
        }

        // Refresh account info from SnapTrade
        const snaptrade = new Snaptrade({
            consumerKey: SNAPTRADE_CONSUMER_KEY,
            clientId: SNAPTRADE_CLIENT_ID,
        });

        const accounts = await Promise.all(
            connections.map(async (conn) => {
                try {
                    const userSecret = decrypt(conn.snaptradeUserSecret);

                    // Get account details
                    if (conn.accountId) {
                        const balanceResponse = await snaptrade.accountInformation.getUserAccountBalance({
                            userId: conn.snaptradeUserId,
                            userSecret,
                            accountId: conn.accountId,
                        });

                        const accountResponse = await snaptrade.accountInformation.getUserAccountDetails({
                            userId: conn.snaptradeUserId,
                            userSecret,
                            accountId: conn.accountId,
                        });

                        // balanceResponse.data is an array of Balance objects
                        const balances = balanceResponse.data || [];
                        // Find USD balance or use first balance
                        const balance = balances.find(b => b.currency?.code === 'USD') || balances[0];
                        const account = accountResponse.data;

                        // Update cached info
                        conn.buyingPower = balance?.buying_power || balance?.cash || undefined;
                        conn.accountName = account?.name || conn.accountName;
                        conn.accountNumber = account?.number || conn.accountNumber;
                        conn.lastSyncedAt = new Date();
                        await conn.save();

                        return {
                            id: conn._id.toString(),
                            brokerName: conn.brokerName || account?.brokerage?.name || 'Unknown',
                            accountName: conn.accountName || account?.name || 'Unknown',
                            accountNumber: conn.accountNumber || account?.number,
                            buyingPower: conn.buyingPower,
                        };
                    }
                } catch (error) {
                    console.error(`Error refreshing account ${conn._id}:`, error);
                }

                // Fallback to cached data
                return {
                    id: conn._id.toString(),
                    brokerName: conn.brokerName || 'Unknown',
                    accountName: conn.accountName || 'Unknown',
                    accountNumber: conn.accountNumber,
                    buyingPower: conn.buyingPower,
                };
            })
        );

        return NextResponse.json({
            success: true,
            accounts,
        });
    } catch (error) {
        console.error('Error fetching accounts:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch accounts' },
            { status: 500 }
        );
    }
}

