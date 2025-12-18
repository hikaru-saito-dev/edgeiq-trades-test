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

    // Use MongoDB _id as persistent SnapTrade userId
    // Format: edgeiq-{mongoId} to ensure it's a valid string format
    const snaptradeUserId = `edgeiq-${companyId}-${whopUserId}`;

    // Check if we already have userSecret stored
    let userSecret: string | undefined;
    let connection = await BrokerConnection.findOne({
      userId: user._id,
      brokerType: 'snaptrade',
      snaptradeUserId: snaptradeUserId,
    });

    if (connection?.snaptradeUserSecret) {
      const conn = await BrokerConnection.findById(connection._id);
      userSecret = conn?.getDecryptedSnaptradeUserSecret() || undefined;
    }

    // Register user if no secret found (idempotent - safe to call multiple times)
    if (!userSecret) {
      const registerResp = await snaptrade.authentication.registerSnapTradeUser({
        userId: snaptradeUserId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userSecret = (registerResp.data as any).userSecret as string;

      // Store userSecret in database (encryption handled by pre-save hook)
      if (connection) {
        connection.snaptradeUserSecret = userSecret;
        connection.isActive = true;
        await connection.save();
      } else {
        connection = new BrokerConnection({
          userId: user._id,
          brokerType: 'snaptrade',
          snaptradeUserId: snaptradeUserId,
          snaptradeUserSecret: userSecret,
          isActive: true,
        });
        await connection.save();
      }
    }

    // 2) Create Connection Portal session (multi-broker portal)
    const loginResp = await snaptrade.authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret,
      immediateRedirect: false,
      customRedirect: `${request.nextUrl.origin}/api/snaptrade/callback`,
      connectionType: 'trade',
      connectionPortalVersion: 'v4',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redirectURI = (loginResp.data as any).redirectURI as string;

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
