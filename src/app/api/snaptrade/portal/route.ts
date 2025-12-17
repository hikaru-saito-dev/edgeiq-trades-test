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
    // MongoDB ObjectId is a 24-character hex string, which should be valid for SnapTrade
    const snaptradeUserId = user._id.toString();

    // Validate userId format (should be non-empty string)
    if (!snaptradeUserId || typeof snaptradeUserId !== 'string' || snaptradeUserId.length === 0) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 },
      );
    }

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

        // Extract userSecret from response - matching SDK test pattern
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const responseData = registerResp.data as { userSecret: string } | any;
        userSecret = responseData?.userSecret || (responseData as { userSecret: string })?.userSecret;

        if (!userSecret || typeof userSecret !== 'string') {
          console.error('SnapTrade registration response missing userSecret');
          return NextResponse.json(
            { error: 'Failed to register SnapTrade user: missing userSecret in response' },
            { status: 500 },
          );
        }
      } catch (error: unknown) {
        const errorResponse = (error as { response?: { status: number; data?: { message?: string; error?: string } } }).response;
        const errorStatus = errorResponse?.status || 500;
        const errorMessage = errorResponse?.data?.message || errorResponse?.data?.error || (error as Error)?.message || 'Failed to register SnapTrade user';

        console.error('SnapTrade registration error:', errorMessage);

        return NextResponse.json(
          {
            error: 'Failed to register SnapTrade user',
            details: errorMessage,
          },
          { status: errorStatus },
        );
      }
    }

    // Ensure we have userSecret before proceeding
    if (!userSecret) {
      return NextResponse.json(
        { error: 'Failed to obtain SnapTrade userSecret' },
        { status: 500 },
      );
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

    const redirectURI = (loginResp.data as { redirectURI: string }).redirectURI;

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
