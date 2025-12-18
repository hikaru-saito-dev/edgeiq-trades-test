import { NextRequest, NextResponse } from 'next/server';
import { Snaptrade } from 'snaptrade-typescript-sdk';

export const runtime = 'nodejs';

const clientId = process.env.SNAPTRADE_CLIENT_ID;
const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;

if (!clientId || !consumerKey) {
  console.warn('SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY is not set in environment variables.');
}

const snaptrade = clientId && consumerKey
  ? new Snaptrade({ clientId, consumerKey })
  : null;

export async function POST(request: NextRequest) {
  try {
    if (!snaptrade || !clientId || !consumerKey) {
      return NextResponse.json(
        { error: 'SnapTrade is not configured. Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY.' },
        { status: 500 },
      );
    }

    const headers = await import('next/headers').then((m) => m.headers());
    const whopUserId = headers.get('x-user-id') || 'anonymous';
    const companyId = headers.get('x-company-id') || 'no-company';

    // For test mode, create a unique SnapTrade user ID each time
    const snaptradeUserId = `edgeiq-test-${companyId}-${whopUserId}-${Date.now()}`;

    // 1) Register SnapTrade user (returns userSecret in .data)
    const registerResp = await snaptrade.authentication.registerSnapTradeUser({
      userId: snaptradeUserId,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userSecret = (registerResp.data as any).userSecret as string;

    // 2) Create Connection Portal session (multi-broker portal)
    const loginResp = await snaptrade.authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret,
      // No broker => show all supported brokers in the portal
      immediateRedirect: false,
      // For test page, redirect back to the same origin root when user finishes
      customRedirect: request.nextUrl.origin,
      connectionType: 'trade', // allow trading + data
      connectionPortalVersion: 'v4',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redirectURI = (loginResp.data as any).redirectURI as string;

    return NextResponse.json({
      success: true,
      redirectURI,
    });
  } catch (error) {
    console.error('SnapTrade portal-test error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
