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
    const snaptradeUserId = searchParams.get('userId'); // SnapTrade userId (format: edgeiq-test-{companyId}-{whopUserId}-{timestamp})
    const connectionId = searchParams.get('connectionId'); // SnapTrade connection UUID

    // Log all query params for debugging
    const allParams: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      allParams[key] = value;
    });

    if (!snaptradeUserId) {
      // If no userId in query, try to get from headers (Whop context)
      const headers = await import('next/headers').then((m) => m.headers());
      const whopUserId = headers.get('x-user-id');
      const companyId = headers.get('x-company-id');

      if (whopUserId && companyId) {
        // Reconstruct snaptradeUserId from current user
        const user = await User.findOne({ whopUserId, companyId });
        if (user) {
          // Find existing connection to get snaptradeUserId
          const existing = await BrokerConnection.findOne({
            userId: user._id,
            brokerType: 'snaptrade',
            isActive: true,
          }).sort({ createdAt: -1 }); // Get most recent

          if (existing?.snaptradeUserId) {
            // Use existing snaptradeUserId
            const registerResp = await snaptrade.authentication.registerSnapTradeUser({
              userId: existing.snaptradeUserId,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userSecret = (registerResp.data as any).userSecret as string;

            const accountsResp = await snaptrade.accountInformation.listUserAccounts({
              userId: existing.snaptradeUserId,
              userSecret: userSecret,
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const accounts = (accountsResp.data as any)?.accounts || [];

            // Save accounts (same logic as below)
            for (const account of accounts) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const accountData = account as any;
              const accountId = accountData.id;
              const brokerName = accountData.brokerage?.name?.toLowerCase() || 'unknown';
              const connId = accountData.connection?.id;

              const existingConn = await BrokerConnection.findOne({
                userId: user._id,
                snaptradeAccountId: accountId,
              });

              if (existingConn) {
                existingConn.snaptradeConnectionId = connId;
                existingConn.snaptradeBrokerName = brokerName;
                existingConn.isActive = true;
                await existingConn.save();
              } else {
                const connection = new BrokerConnection({
                  userId: user._id,
                  brokerType: 'snaptrade',
                  snaptradeUserId: existing.snaptradeUserId,
                  snaptradeUserSecret: userSecret,
                  snaptradeAccountId: accountId,
                  snaptradeConnectionId: connId,
                  snaptradeBrokerName: brokerName,
                  isActive: true,
                  paperTrading: false,
                });
                await connection.save();
              }
            }

            // Return success page
            const html = `
              <!DOCTYPE html>
              <html>
                <head><title>Connection Complete</title></head>
                <body>
                  <script>
                    if (window.opener) {
                      window.opener.postMessage({ status: 'SUCCESS', accounts: ${accounts.length} }, '*');
                      setTimeout(() => window.close(), 500);
                    }
                  </script>
                  <div style="text-align: center; padding: 40px;">
                    <h2>Connection Successful!</h2>
                    <p>You can close this window.</p>
                  </div>
                </body>
              </html>
            `;
            return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
          }
        }
      }

      // Still no userId - return error
      return NextResponse.redirect(new URL(`/?error=missing_user_id&params=${encodeURIComponent(JSON.stringify(allParams))}`, request.url));
    }

    // Extract whopUserId and companyId from SnapTrade userId format
    // Format: edgeiq-test-{companyId}-{whopUserId}-{timestamp}
    const match = snaptradeUserId.match(/^edgeiq-test-(.+?)-(.+?)-(\d+)$/);
    if (!match) {
      return NextResponse.redirect(new URL('/?error=invalid_user_id_format', request.url));
    }

    const [, companyId, whopUserId] = match;

    // Find user by whopUserId and companyId
    const user = await User.findOne({ whopUserId, companyId });
    if (!user) {
      return NextResponse.redirect(new URL('/?error=user_not_found', request.url));
    }

    // Register/get userSecret (idempotent - returns same secret if user exists)
    const registerResp = await snaptrade.authentication.registerSnapTradeUser({
      userId: snaptradeUserId,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userSecret = (registerResp.data as any).userSecret as string;

    if (!userSecret) {
      return NextResponse.redirect(new URL('/?error=missing_user_secret', request.url));
    }

    // Fetch connected accounts for this user
    const accountsResp = await snaptrade.accountInformation.listUserAccounts({
      userId: snaptradeUserId,
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
          snaptradeUserId: snaptradeUserId,
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
