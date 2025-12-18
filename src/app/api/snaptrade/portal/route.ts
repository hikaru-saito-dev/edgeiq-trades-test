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
 * Following the official SnapTrade SDK pattern from their documentation
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
    const brokerSlug = (body.brokerSlug as string) || undefined;

    // Use user's MongoDB _id as the SnapTrade userId (persistent per user)
    const snaptradeUserId = user._id.toString();

    // Step 1: Register or get existing userSecret
    // Following SDK pattern: registerSnapTradeUser is idempotent
    let userSecret: string | undefined;

    // Check if we already have userSecret stored
    const existingConnection = await BrokerConnection.findOne({
      userId: user._id,
      brokerType: 'snaptrade',
      snaptradeUserId: snaptradeUserId,
    });

    if (existingConnection?.snaptradeUserSecret) {
      const conn = await BrokerConnection.findById(existingConnection._id);
      const decrypted = conn?.getDecryptedSnaptradeUserSecret();
      if (decrypted) {
        userSecret = decrypted;
      }
    }

    // If no stored secret, register with SnapTrade
    if (!userSecret) {
      // Following SDK example pattern exactly
      const registerResp = await snaptrade.authentication.registerSnapTradeUser({
        userId: snaptradeUserId,
      });

      // Extract userSecret following SDK test pattern
      const { userSecret: secret } = registerResp.data as { userSecret: string };
      if (!secret) {
        return NextResponse.json(
          { error: 'Failed to register SnapTrade user: missing userSecret in response' },
          { status: 500 },
        );
      }
      userSecret = secret;
    }

    // Ensure we have userSecret
    if (!userSecret) {
      return NextResponse.json(
        { error: 'Failed to obtain SnapTrade userSecret' },
        { status: 500 },
      );
    }

    // Step 2: Generate Connection Portal URL
    // Following SDK example pattern exactly
    const loginResp = await snaptrade.authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret: userSecret,
      broker: brokerSlug, // Optional: specific broker or undefined for all
      immediateRedirect: false,
      customRedirect: `${request.nextUrl.origin}/api/snaptrade/callback`,
      connectionType: 'trade',
      connectionPortalVersion: 'v4',
    });

    // Extract redirectURI following SDK pattern
    const data = loginResp.data as { redirectURI?: string };
    if (!('redirectURI' in data) || !data.redirectURI) {
      return NextResponse.json(
        { error: 'Failed to generate connection portal URL' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      redirectURI: data.redirectURI,
      userId: snaptradeUserId,
    });
  } catch (error) {
    // Extract error details from Axios error
    const axiosError = error as { response?: { status: number; data?: any }; message?: string };
    const errorResponse = axiosError?.response;
    const errorStatus = errorResponse?.status || 500;

    // Log the actual error response from SnapTrade
    if (errorResponse?.data) {
      console.error('SnapTrade API error response:', JSON.stringify(errorResponse.data, null, 2));
    }

    // Extract error message
    const errorMessage = errorResponse?.data?.message
      || errorResponse?.data?.error
      || errorResponse?.data?.detail
      || axiosError?.message
      || 'Unknown error';

    console.error('SnapTrade portal error:', {
      status: errorStatus,
      message: errorMessage,
      hasResponseData: !!errorResponse?.data,
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        status: errorStatus,
      },
      { status: errorStatus },
    );
  }
}
