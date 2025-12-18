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
    const snaptradeUserId = searchParams.get('userId') || searchParams.get('snaptradeUserId'); // SnapTrade userId (format: edgeiq-test-{companyId}-{whopUserId}-{timestamp})
    const connectionId = searchParams.get('connectionId'); // SnapTrade connection UUID

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
      return NextResponse.redirect(new URL('/?error=missing_user_id', request.url));
    }

    // Extract whopUserId and companyId from SnapTrade userId format
    // Format: edgeiq-test-{companyId}-{whopUserId} (no timestamp in new format)
    // Also support old format: edgeiq-test-{companyId}-{whopUserId}-{timestamp}
    let companyId: string;
    let whopUserId: string;

    const matchWithTimestamp = snaptradeUserId.match(/^edgeiq-test-(.+?)-(.+?)-(\d+)$/);
    const matchWithoutTimestamp = snaptradeUserId.match(/^edgeiq-test-(.+?)-(.+?)$/);

    if (matchWithTimestamp) {
      // Old format with timestamp
      [, companyId, whopUserId] = matchWithTimestamp;
    } else if (matchWithoutTimestamp) {
      // New format without timestamp
      [, companyId, whopUserId] = matchWithoutTimestamp;
    } else {
      return NextResponse.redirect(new URL('/?error=invalid_user_id_format', request.url));
    }

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

    if (accounts.length === 0) {
      // No accounts found - this might be normal if connection is still pending
      return NextResponse.redirect(new URL('/?error=no_accounts_found', request.url));
    }

    // Save each connected account as a BrokerConnection
    const savedAccounts: string[] = [];
    for (const account of accounts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accountData = account as any;
      const accountId = accountData.id;
      const brokerName = accountData.brokerage?.name?.toLowerCase() || 'unknown';
      const connectionId = accountData.connection?.id;

      // Check if connection already exists
      const existing = await BrokerConnection.findOne({
        userId: user._id,
        snaptradeAccountId: accountId,
      });

      try {
        if (existing) {
          // Update existing connection
          existing.snaptradeConnectionId = connectionId;
          existing.snaptradeBrokerName = brokerName;
          existing.snaptradeUserId = snaptradeUserId; // Ensure userId is set
          existing.snaptradeUserSecret = userSecret; // Update secret (will be encrypted by pre-save hook)
          existing.isActive = true;
          await existing.save();
          savedAccounts.push(accountId);
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
          savedAccounts.push(accountId);
        }
      } catch (saveError) {
        console.error(`Failed to save connection for account ${accountId}:`, saveError);
      }
    }

    // Verify accounts were saved
    if (savedAccounts.length === 0) {
      return NextResponse.redirect(new URL('/?error=save_failed', request.url));
    }

    // Return HTML page that sends postMessage to opener window (OAuth opened in new tab)
    // The callback is called in the OAuth tab, so we send message to opener (the main window)
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connection Complete</title>
        </head>
        <body>
          <script>
            // Send success message to opener window (popup context)
            // When callback runs in popup, window.opener is the main window
            const sendMessage = () => {
              const message = {
                status: 'SUCCESS',
                authorizationId: '${connectionId || 'connected'}',
                accounts: ${savedAccounts.length},
                source: 'callback'
              };
              
              // Try opener first (popup context)
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage(message, '*');
              }
              // Fallback: try parent (iframe context)
              else if (window.parent && window.parent !== window) {
                window.parent.postMessage(message, '*');
              }
              // Last resort: redirect
              else {
                window.location.href = '/brokers?connected=true';
              }
              
              // Close popup after sending message
              setTimeout(() => {
                if (window.opener) {
                  window.close();
                }
              }, 500);
            };
            
            // Send immediately and also on load (in case script runs before DOM ready)
            sendMessage();
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', sendMessage);
            } else {
              window.addEventListener('load', sendMessage);
            }
          </script>
          <div style="text-align: center; padding: 40px; font-family: Arial, sans-serif;">
            <h2>Connection Successful!</h2>
            <p>This window will close automatically.</p>
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
