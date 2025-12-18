import { NextRequest, NextResponse } from 'next/server';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';

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

    await connectDB();

    const headers = await import('next/headers').then((m) => m.headers());
    const whopUserId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!whopUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findOne({ whopUserId, companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const brokerSlug = (body.brokerSlug as string) || undefined;

    // Check if user already has a SnapTrade connection - reuse snaptradeUserId
    let snaptradeUserId: string;
    const existingConnection = await BrokerConnection.findOne({
      userId: user._id,
      brokerType: 'snaptrade',
      isActive: true,
      snaptradeUserId: { $exists: true, $ne: null },
    }).sort({ createdAt: -1 }); // Get most recent

    if (existingConnection?.snaptradeUserId) {
      // Reuse existing snaptradeUserId
      snaptradeUserId = existingConnection.snaptradeUserId;
    } else {
      // Create new snaptradeUserId (without timestamp for consistency)
      // Format: edgeiq-{companyId}-{whopUserId} (no timestamp to ensure consistency)
      snaptradeUserId = `edgeiq-${companyId}-${whopUserId}`;
    }

    // 1) Register SnapTrade user (returns userSecret in .data)
    // Idempotent - safe to call multiple times, returns same userSecret if user already exists
    const registerResp = await snaptrade.authentication.registerSnapTradeUser({
      userId: snaptradeUserId,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userSecret = (registerResp.data as any).userSecret as string;

    // 2) Create Connection Portal session
    // Include userId in customRedirect so SnapTrade passes it back in callback
    // For Whop apps, use the request origin (works in iframe context)
    // If NEXT_PUBLIC_APP_URL is set, use that for production
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const callbackUrl = new URL('/api/snaptrade/callback', baseUrl);
    callbackUrl.searchParams.set('userId', snaptradeUserId);

    const loginResp = await snaptrade.authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret,
      immediateRedirect: false,
      customRedirect: callbackUrl.toString(),
      connectionType: 'trade',
      connectionPortalVersion: 'v4',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let redirectURI = (loginResp.data as any).redirectURI as string;

    // Append iframe=true to portal URL to ensure OAuth stays in iframe
    // SnapTrade's passSession endpoint will handle OAuth redirects in iframe mode
    if (redirectURI && !redirectURI.includes('iframe=true')) {
      const url = new URL(redirectURI);
      url.searchParams.set('iframe', 'true');
      redirectURI = url.toString();
    }

    return NextResponse.json({
      success: true,
      redirectURI,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
