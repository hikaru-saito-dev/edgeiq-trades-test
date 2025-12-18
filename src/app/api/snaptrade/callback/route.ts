import { NextRequest, NextResponse } from 'next/server';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';

export const runtime = 'nodejs';

const clientId = process.env.SNAPTRADE_CLIENT_ID;
const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;

const snaptrade = clientId && consumerKey
  ? new Snaptrade({ clientId, consumerKey })
  : null;

/**
 * GET /api/snaptrade/callback
 * Handle SnapTrade Connection Portal redirect after user completes connection
 * This route is called by SnapTrade after the user finishes the connection flow
 */
export async function GET(request: NextRequest) {
  try {
    if (!snaptrade || !clientId || !consumerKey) {
      return NextResponse.redirect(new URL('/?error=snaptrade_not_configured', request.url));
    }

    await connectDB();

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId'); // SnapTrade userId (our user's MongoDB _id)
    const connectionId = searchParams.get('connectionId'); // SnapTrade connection UUID

    if (!userId) {
      return NextResponse.redirect(new URL('/?error=missing_user_id', request.url));
    }

    // Find user by MongoDB _id
    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.redirect(new URL('/?error=user_not_found', request.url));
    }

    // Get or create userSecret
    // First, try to find existing connection to get userSecret
    let userSecret: string | undefined;
    const existingConnection = await BrokerConnection.findOne({
      userId: user._id,
      brokerType: 'snaptrade',
      snaptradeUserId: userId,
    });

    if (existingConnection?.snaptradeUserSecret) {
      const conn = await BrokerConnection.findById(existingConnection._id);
      userSecret = conn?.getDecryptedSnaptradeUserSecret() || undefined;
    }

    // If no existing connection, register new SnapTrade user
    if (!userSecret) {
      const registerResp = await snaptrade.authentication.registerSnapTradeUser({
        userId: userId,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userSecret = (registerResp.data as any).userSecret as string;
    }

    if (!userSecret) {
      return NextResponse.redirect(new URL('/?error=missing_user_secret', request.url));
    }

    // Fetch connected accounts for this user
    const accountsResp = await snaptrade.accountInformation.listUserAccounts({
      userId: userId,
      userSecret: userSecret,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = (accountsResp.data as any)?.accounts || [];

    // Save each connected account as a BrokerConnection
    for (const account of accounts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accountData = account as any;
      const accountId = accountData.id;
      const brokerName = accountData.brokerage?.name?.toLowerCase() || 'unknown';
      const connectionId = accountData.connection?.id;

      // Map broker name to our brokerType
      let brokerType: 'alpaca' | 'webull' | 'snaptrade' = 'snaptrade';
      if (brokerName.includes('webull')) {
        brokerType = 'snaptrade'; // Still use 'snaptrade' type, but store broker name
      } else if (brokerName.includes('alpaca')) {
        brokerType = 'snaptrade';
      }

      // Check if connection already exists
      const existing = await BrokerConnection.findOne({
        userId: user._id,
        snaptradeAccountId: accountId,
      });

      if (existing) {
        // Update existing connection
        existing.snaptradeConnectionId = connectionId;
        existing.snaptradeBrokerName = brokerName;
        existing.isActive = true;
        await existing.save();
      } else {
        // Create new connection
        const connection = new BrokerConnection({
          userId: user._id,
          brokerType: 'snaptrade',
          snaptradeUserId: userId,
          snaptradeUserSecret: userSecret, // Will be encrypted by pre-save hook
          snaptradeAccountId: accountId,
          snaptradeConnectionId: connectionId,
          snaptradeBrokerName: brokerName,
          isActive: true,
          paperTrading: false, // SnapTrade accounts are typically live (user controls this in their broker)
        });
        await connection.save();
      }
    }

    // Return HTML page that sends postMessage to parent window (for iframe modal)
    // This allows the connection to complete within Whop context
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connection Complete</title>
        </head>
        <body>
          <script>
            // Send success message to parent window (Whop)
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({
                status: 'SUCCESS',
                authorizationId: '${connectionId || 'connected'}',
                accounts: ${JSON.stringify(accounts.length)}
              }, '*');
            }
            // Handle case where OAuth opened in new tab (from iframe breakout)
            // Send message to opener (the Whop window that opened the modal)
            if (window.opener) {
              window.opener.postMessage({
                status: 'SUCCESS',
                authorizationId: '${connectionId || 'connected'}',
                accounts: ${JSON.stringify(accounts.length)}
              }, '*');
              // Close this tab after a short delay
              setTimeout(() => {
                window.close();
              }, 500);
            }
            // Fallback: redirect if no parent/opener
            setTimeout(() => {
              window.location.href = '/brokers?connected=true';
            }, 1000);
          </script>
          <div style="text-align: center; padding: 40px; font-family: Arial, sans-serif;">
            <h2>Connection Successful!</h2>
            <p>You can close this window.</p>
          </div>
        </body>
      </html>
    `;
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('SnapTrade callback error:', error);
    return NextResponse.redirect(new URL('/?error=connection_failed', request.url));
  }
}
