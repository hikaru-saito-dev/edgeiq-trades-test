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
 * GET /api/snaptrade/callback
 * Handle SnapTrade OAuth callback and finalize connection
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const userId = searchParams.get('userId');

    if (!SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_CLIENT_ID) {
      return NextResponse.redirect(new URL('/profile?error=config_error', request.url));
    }

    let connection;
    let user;

    // Try to find connection by connectionId first
    if (connectionId) {
      connection = await BrokerConnection.findById(connectionId);
      if (connection) {
        user = await User.findById(connection.userId);
      }
    }

    // If not found and userId provided, find the most recent inactive connection for this user
    if (!connection && userId) {
      user = await User.findOne({ whopUserId: userId });
      if (user) {
        // Find most recent inactive connection created in last 10 minutes
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        connection = await BrokerConnection.findOne({
          userId: user._id,
          isActive: false,
          brokerType: 'snaptrade',
          createdAt: { $gte: tenMinutesAgo },
        }).sort({ createdAt: -1 }); // Get most recent
      }
    }

    // Last resort: find any recent inactive connection (within last 10 minutes)
    if (!connection) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      connection = await BrokerConnection.findOne({
        isActive: false,
        brokerType: 'snaptrade',
        createdAt: { $gte: tenMinutesAgo },
      }).sort({ createdAt: -1 });

      if (connection) {
        user = await User.findById(connection.userId);
      }
    }

    if (!connection) {
      console.error('Callback: No connection found', { connectionId, userId });
      return NextResponse.redirect(new URL('/profile?error=connection_not_found', request.url));
    }

    if (!user) {
      user = await User.findById(connection.userId);
      if (!user) {
        return NextResponse.redirect(new URL('/profile?error=user_not_found', request.url));
      }
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
      return NextResponse.redirect(new URL('/profile?error=no_accounts', request.url));
    }

    // Get authorizations to find broker info
    const authorizationsResponse = await snaptrade.connections.listBrokerageAuthorizations({
      userId: connection.snaptradeUserId,
      userSecret,
    });

    // Use first account (user can select different one later)
    const firstAccount = accountsResponse.data[0];
    const authorization = authorizationsResponse.data?.[0];

    if (!firstAccount || !firstAccount.id) {
      console.error('Callback: Invalid account data', { accounts: accountsResponse.data });
      return NextResponse.redirect(new URL('/profile?error=invalid_account_data', request.url));
    }

    // Update connection with account info
    connection.accountId = firstAccount.id;
    connection.authorizationId = authorization?.id || firstAccount.brokerage_authorization;
    connection.isActive = true;
    // Use institution_name from Account or brokerage name from authorization
    connection.brokerName = authorization?.brokerage?.name || firstAccount.institution_name || 'Unknown';
    connection.accountName = firstAccount.name || firstAccount.number || 'Unknown';
    connection.accountNumber = firstAccount.number || firstAccount.id; // Fallback to account ID if no number
    connection.lastSyncedAt = new Date();

    // Get buying power
    try {
      const balanceResponse = await snaptrade.accountInformation.getUserAccountBalance({
        userId: connection.snaptradeUserId,
        userSecret,
        accountId: firstAccount.id,
      });

      // balanceResponse.data is an array of Balance objects
      const balances = balanceResponse.data || [];
      const balance = balances.find(b => b.currency?.code === 'USD') || balances[0];
      if (balance) {
        connection.buyingPower = balance.buying_power || balance.cash || undefined;
      }
    } catch (error) {
      console.warn('Failed to fetch buying power:', error);
    }

    const savedConnection = await connection.save();


    // Verify it was saved by querying again
    const verifyConnection = await BrokerConnection.findById(savedConnection._id);
    if (!verifyConnection || !verifyConnection.isActive) {
      console.error('Callback: Connection verification failed!', {
        found: !!verifyConnection,
        isActive: verifyConnection?.isActive,
      });
    }

    // Redirect to profile with success and userId for the frontend to reload
    const redirectUrl = new URL('/profile', request.url);
    redirectUrl.searchParams.set('success', 'connected');
    redirectUrl.searchParams.set('userId', user.whopUserId);

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('SnapTrade callback error:', error);
    return NextResponse.redirect(
      new URL(`/profile?error=${encodeURIComponent(error instanceof Error ? error.message : 'callback_failed')}`, request.url)
    );
  }
}

