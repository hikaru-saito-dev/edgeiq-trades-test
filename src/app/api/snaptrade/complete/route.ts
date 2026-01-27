import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
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

        // Get credentials from cookie (set during /connect)
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        const stateToken = cookieStore.get('snaptrade_connect_state')?.value;

        if (!stateToken) {
            // Check if user already has an active connection (OAuth might have completed via callback)
            const existingConnection = await BrokerConnection.findOne({
                userId: user._id,
                brokerType: 'snaptrade',
                isActive: true,
            }).sort({ createdAt: -1 });

            if (existingConnection && existingConnection.accountId) {
                return NextResponse.json({
                    success: true,
                    connection: {
                        id: existingConnection._id.toString(),
                        brokerName: existingConnection.brokerName,
                        accountName: existingConnection.accountName,
                        accountNumber: existingConnection.accountNumber,
                        buyingPower: existingConnection.buyingPower,
                    },
                    message: 'Connection already active',
                });
            }

            return NextResponse.json(
                { error: 'No active connection found. Please try connecting again.' },
                { status: 404 }
            );
        }

        // Decode state token
        let stateData: { userId: string; snaptradeUserId: string; encryptedSecret: string; timestamp: number };
        try {
            const decoded = Buffer.from(stateToken, 'base64url').toString('utf-8');
            stateData = JSON.parse(decoded);

            // Check if token is expired (10 minutes)
            if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
                return NextResponse.json(
                    { error: 'Session expired. Please try connecting again.' },
                    { status: 400 }
                );
            }
        } catch (error) {
            return NextResponse.json(
                { error: 'Invalid session. Please try connecting again.' },
                { status: 400 }
            );
        }

        // Initialize SnapTrade client
        const snaptrade = new Snaptrade({
            consumerKey: SNAPTRADE_CONSUMER_KEY,
            clientId: SNAPTRADE_CLIENT_ID,
        });

        // Decrypt user secret
        const userSecret = decrypt(stateData.encryptedSecret);

        // Get user's accounts with retry logic (Webull accounts may need time to sync)
        let accountsResponse;
        let retries = 3;
        let delay = 1000;

        while (retries > 0) {
            try {
                accountsResponse = await snaptrade.accountInformation.listUserAccounts({
                    userId: stateData.snaptradeUserId,
                    userSecret,
                });

                if (accountsResponse.data && accountsResponse.data.length > 0) {
                    break;
                }

                if (retries > 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
                retries--;
            } catch (error) {
                if (retries === 1) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                retries--;
            }
        }

        if (!accountsResponse || !accountsResponse.data || accountsResponse.data.length === 0) {
            return NextResponse.json(
                {
                    error: 'No accounts found. The broker account may still be syncing. Please wait a moment and try refreshing, or reconnect if the issue persists.',
                },
                { status: 400 }
            );
        }

        // Get authorizations to find broker info
        let authorizationsResponse;
        try {
            authorizationsResponse = await snaptrade.connections.listBrokerageAuthorizations({
                userId: stateData.snaptradeUserId,
                userSecret,
            });
        } catch (error) {
            console.warn('Failed to fetch authorizations, proceeding with account data only:', error);
            authorizationsResponse = { data: [] };
        }

        // Find the account that's not already associated with an active connection
        let firstAccount = accountsResponse.data[0];
        const authorization = authorizationsResponse.data?.[0];
        const authorizationId = authorization?.id || firstAccount.brokerage_authorization;

        // Check for existing connections to prevent duplicates
        const activeConnections = await BrokerConnection.find({
            userId: user._id,
            brokerType: 'snaptrade',
            isActive: true,
            accountId: { $exists: true, $ne: null },
        });

        const activeAccountIds = new Set(activeConnections.map(c => c.accountId).filter(Boolean));
        const activeAccountNumbers = new Set(activeConnections.map(c => c.accountNumber).filter(Boolean));
        const activeAuthorizationIds = new Set(activeConnections.map(c => c.authorizationId).filter(Boolean));

        // Extract account number from the account data
        const accountNumber = firstAccount.number || firstAccount.id;

        // If we have multiple accounts, prefer the one that's not already connected
        if (accountsResponse.data.length > 1) {
            const newAccount = accountsResponse.data.find(acc => {
                const accNumber = acc.number || acc.id;
                return !activeAccountIds.has(acc.id) && !activeAccountNumbers.has(accNumber);
            });
            if (newAccount) {
                firstAccount = newAccount;
            }
        }

        if (!firstAccount || !firstAccount.id) {
            return NextResponse.json(
                { error: 'Invalid account data' },
                { status: 500 }
            );
        }

        // CRITICAL: Check if this account number is already connected (most reliable identifier)
        if (activeAccountNumbers.has(accountNumber)) {
            return NextResponse.json(
                { error: `Account "${accountNumber}" is already connected. Please disconnect the existing connection first if you want to reconnect.` },
                { status: 400 }
            );
        }

        // CRITICAL: Check if this exact account ID is already connected (backup check)
        if (activeAccountIds.has(firstAccount.id)) {
            return NextResponse.json(
                { error: 'This account is already connected. Please select a different account or disconnect the existing connection first.' },
                { status: 400 }
            );
        }

        // CRITICAL: Check if this authorization is already connected (prevent duplicate broker connections)
        // Note: We allow multiple accounts from the same broker, but not the same account
        if (authorizationId && activeAuthorizationIds.has(authorizationId)) {
            // Double-check: make sure this isn't a different account with the same authorization
            const existingWithAuth = activeConnections.find(c => c.authorizationId === authorizationId);
            if (existingWithAuth && (existingWithAuth.accountId === firstAccount.id || existingWithAuth.accountNumber === accountNumber)) {
                return NextResponse.json(
                    { error: 'This broker account is already connected. Please disconnect the existing connection first if you want to reconnect.' },
                    { status: 400 }
                );
            }
        }

        // FINAL CHECK: Double-check right before creating to prevent race conditions
        const finalCheck = await BrokerConnection.findOne({
            userId: user._id,
            brokerType: 'snaptrade',
            isActive: true,
            $or: [
                { accountId: firstAccount.id },
                { accountNumber: accountNumber }
            ],
        });

        if (finalCheck) {
            return NextResponse.json(
                { error: 'This account is already connected. Please refresh the page to see your connections.' },
                { status: 400 }
            );
        }

        // CREATE the connection record now that OAuth succeeded
        const connection = await BrokerConnection.create({
            userId: user._id,
            whopUserId: user.whopUserId,
            brokerType: 'snaptrade',
            snaptradeUserId: stateData.snaptradeUserId,
            snaptradeUserSecret: stateData.encryptedSecret,
            accountId: firstAccount.id,
            authorizationId: authorizationId,
            isActive: true,
            brokerName: authorization?.brokerage?.name || firstAccount.institution_name || 'Unknown',
            accountName: firstAccount.name || firstAccount.number || 'Unknown',
            accountNumber: accountNumber,
            connectedAt: new Date(),
            lastSyncedAt: new Date(),
        });

        // Get buying power
        try {
            const balanceResponse = await snaptrade.accountInformation.getUserAccountBalance({
                userId: stateData.snaptradeUserId,
                userSecret,
                accountId: firstAccount.id,
            });

            const balances = balanceResponse.data || [];
            const balance = balances.find(b => b.currency?.code === 'USD') || balances[0];
            if (balance) {
                connection.buyingPower = balance.buying_power || balance.cash || undefined;
                await connection.save();
            }
        } catch (error) {
            console.warn('Failed to fetch buying power:', error);
        }

        // Clear the state cookie
        cookieStore.delete('snaptrade_connect_state');

        // Invalidate broker cache
        const { invalidateBrokerCache } = await import('@/lib/cache/brokerCache');
        invalidateBrokerCache(user.whopUserId, String(user._id));

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
        
        // Clean up cookie on error
        try {
            const { cookies } = await import('next/headers');
            const cookieStore = await cookies();
            cookieStore.delete('snaptrade_connect_state');
        } catch {
            // Ignore cookie cleanup errors
        }
        
        // Extract detailed error information
        let errorMessage = 'Failed to complete connection';
        const errorDetails: string[] = [];

        if (error && typeof error === 'object') {
            // Check for HTTP status codes
            let httpStatus: number | undefined;
            if ('status' in error && typeof error.status === 'number') {
                httpStatus = error.status;
            } else if ('statusCode' in error && typeof error.statusCode === 'number') {
                httpStatus = error.statusCode;
            } else if ('response' in error && error.response && typeof error.response === 'object') {
                const response = error.response as { status?: number; statusCode?: number; data?: unknown; body?: unknown };
                if (typeof response.status === 'number') {
                    httpStatus = response.status;
                }
                const responseBody = response.data || response.body;
                if (responseBody && typeof responseBody === 'object') {
                    const body = responseBody as { error?: string; message?: string; detail?: string };
                    errorMessage = body.error || body.message || body.detail || errorMessage;
                }
            }

            if (httpStatus === 402) {
                errorMessage = 'Payment Required: Your SnapTrade account may require a paid subscription to access this broker. Please check your SnapTrade subscription status.';
            } else if (httpStatus === 401) {
                errorMessage = 'Unauthorized: Your SnapTrade connection may have expired. Please reconnect your broker account.';
            } else if (httpStatus === 404) {
                errorMessage = 'Not Found: The account or authorization may have been deleted. Please reconnect your broker account.';
            }

            errorDetails.push(`Error Structure: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`);
            if (httpStatus) {
                errorDetails.push(`HTTP Status: ${httpStatus}`);
            }
        } else if (error instanceof Error) {
            errorMessage = error.message;
            errorDetails.push(`Error: ${error.message}`);
            if (error.stack) {
                errorDetails.push(`Stack: ${error.stack}`);
            }
        }

        return NextResponse.json(
            {
                error: errorMessage,
                details: errorDetails.length > 0 ? errorDetails.join('\n') : undefined,
            },
            { status: 500 }
        );
    }
}

