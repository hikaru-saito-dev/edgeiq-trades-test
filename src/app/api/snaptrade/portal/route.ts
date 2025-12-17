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

/**
 * POST /api/snaptrade/portal
 * Create a SnapTrade Connection Portal session for linking a broker account
 */
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

    // Find user
    const user = await User.findOne({ whopUserId, companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const brokerSlug = (body.brokerSlug as string) || undefined; // e.g., 'webull', 'alpaca', etc.

    // Use user's MongoDB _id as the SnapTrade userId (persistent per user)
    const snaptradeUserId = user._id.toString();

    // Check if user already has a SnapTrade user registered
    // First, try to get existing userSecret from BrokerConnection
    let userSecret: string | undefined;
    const existingConnection = await BrokerConnection.findOne({
      userId: user._id,
      brokerType: 'snaptrade',
      snaptradeUserId: snaptradeUserId,
    });

    if (existingConnection?.snaptradeUserSecret) {
      const conn = await BrokerConnection.findById(existingConnection._id);
      userSecret = conn?.getDecryptedSnaptradeUserSecret() || undefined;
    }

    // If no existing connection, register new SnapTrade user
    // This is idempotent - SnapTrade will return existing userSecret if already registered
    if (!userSecret) {
      try {
        const registerResp = await snaptrade.authentication.registerSnapTradeUser({
          userId: snaptradeUserId,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userSecret = (registerResp.data as any).userSecret as string;
      } catch (error) {
        console.error('SnapTrade registration error:', error);
        return NextResponse.json(
          { error: 'Failed to register SnapTrade user' },
          { status: 500 },
        );
      }
    }

    // Create Connection Portal session
    const loginResp = await snaptrade.authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret,
      broker: brokerSlug, // Specific broker slug or undefined for all brokers
      immediateRedirect: false,
      customRedirect: `${request.nextUrl.origin}/api/snaptrade/callback`,
      connectionType: 'trade', // allow trading + data
      connectionPortalVersion: 'v4',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redirectURI = (loginResp.data as any).redirectURI as string;

    return NextResponse.json({
      success: true,
      redirectURI,
      userId: snaptradeUserId, // Return for frontend to track
    });
  } catch (error) {
    console.error('SnapTrade portal error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
