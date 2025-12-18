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
    
    if (!connectionId || !userId) {
      return NextResponse.redirect(new URL('/profile?error=missing_params', request.url));
    }

    if (!SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_CLIENT_ID) {
      return NextResponse.redirect(new URL('/profile?error=config_error', request.url));
    }

    // Find connection
    const connection = await BrokerConnection.findById(connectionId);
    if (!connection) {
      return NextResponse.redirect(new URL('/profile?error=connection_not_found', request.url));
    }

    // Verify user matches
    const user = await User.findById(connection.userId);
    if (!user || user.whopUserId !== userId) {
      return NextResponse.redirect(new URL('/profile?error=unauthorized', request.url));
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

    // Update connection with account info
    connection.accountId = firstAccount.id;
    connection.authorizationId = authorization?.id;
    connection.isActive = true;
    connection.brokerName = authorization?.brokerage?.name || 'Unknown';
    connection.accountName = firstAccount.name || firstAccount.number || 'Unknown';
    connection.accountNumber = firstAccount.number;
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

    await connection.save();

    return NextResponse.redirect(new URL('/profile?success=connected', request.url));
  } catch (error) {
    console.error('SnapTrade callback error:', error);
    return NextResponse.redirect(
      new URL(`/profile?error=${encodeURIComponent(error instanceof Error ? error.message : 'callback_failed')}`, request.url)
    );
  }
}

