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
 * Handle SnapTrade OAuth callback and create connection record
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_CLIENT_ID) {
      return NextResponse.redirect(new URL('/profile?error=config_error', request.url));
    }

    // Get credentials from cookie (set during /connect)
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const stateToken = cookieStore.get('snaptrade_connect_state')?.value;

    if (!stateToken) {
      console.error('Callback: No state token found');
      return NextResponse.redirect(new URL('/profile?error=session_expired', request.url));
    }

    // Decode state token
    let stateData: { userId: string; snaptradeUserId: string; encryptedSecret: string; timestamp: number };
    try {
      const decoded = Buffer.from(stateToken, 'base64url').toString('utf-8');
      stateData = JSON.parse(decoded);

      // Check if token is expired (10 minutes)
      if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
        return NextResponse.redirect(new URL('/profile?error=session_expired', request.url));
      }
    } catch (error) {
      console.error('Callback: Failed to decode state token', error);
      return NextResponse.redirect(new URL('/profile?error=invalid_session', request.url));
    }

    // Find user
    const user = await User.findOne({ whopUserId: stateData.userId || userId });
    if (!user) {
      return NextResponse.redirect(new URL('/profile?error=user_not_found', request.url));
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
          break; // Accounts found, exit retry loop
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
      return NextResponse.redirect(new URL('/profile?error=no_accounts', request.url));
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
      console.error('Callback: Invalid account data', { accounts: accountsResponse.data });
      return NextResponse.redirect(new URL('/profile?error=invalid_account_data', request.url));
    }

    // Extract identifiers AFTER selecting the final account
    // Prefer account.brokerage_authorization since it is tied to the selected account.
    const accountNumber = firstAccount.number || firstAccount.id;
    const authorizationId = firstAccount.brokerage_authorization || authorization?.id;

    // CRITICAL: Check if this account number is already connected (most reliable identifier)
    if (activeAccountNumbers.has(accountNumber)) {
      console.warn('Callback: Account number already connected', { accountNumber, accountId: firstAccount.id });
      return NextResponse.redirect(new URL('/profile?error=account_already_connected', request.url));
    }

    // CRITICAL: Check if this exact account ID is already connected (backup check)
    if (activeAccountIds.has(firstAccount.id)) {
      console.warn('Callback: Account ID already connected', { accountId: firstAccount.id, accountNumber });
      return NextResponse.redirect(new URL('/profile?error=account_already_connected', request.url));
    }

    // CRITICAL: Check if this authorization is already connected (prevent duplicate broker connections)
    // Note: We allow multiple accounts from the same broker, but not the same account
    if (authorizationId && activeAuthorizationIds.has(authorizationId)) {
      // Double-check: make sure this isn't a different account with the same authorization
      const existingWithAuth = activeConnections.find(c => c.authorizationId === authorizationId);
      if (existingWithAuth && (existingWithAuth.accountId === firstAccount.id || existingWithAuth.accountNumber === accountNumber)) {
        console.warn('Callback: Authorization already connected with same account', { authorizationId, accountId: firstAccount.id, accountNumber });
        return NextResponse.redirect(new URL('/profile?error=broker_already_connected', request.url));
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
      console.warn('Callback: Account already connected (race condition prevented)', { accountId: firstAccount.id, accountNumber });
      return NextResponse.redirect(new URL('/profile?error=account_already_connected', request.url));
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

    // Redirect to profile with success and userId for the frontend to reload
    const redirectUrl = new URL('/profile', request.url);
    redirectUrl.searchParams.set('success', 'connected');
    redirectUrl.searchParams.set('userId', user.whopUserId);

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('SnapTrade callback error:', error);
    
    // Clean up cookie on error
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      cookieStore.delete('snaptrade_connect_state');
    } catch {
      // Ignore cookie cleanup errors
    }
    
    // Don't expose internal error details to user
    return NextResponse.redirect(
      new URL('/profile?error=connection_failed', request.url)
    );
  }
}

