import { NextRequest, NextResponse } from 'next/server';
import { Snaptrade } from 'snaptrade-typescript-sdk';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { BrokerConnection } from '@/models/BrokerConnection';
import { Types } from 'mongoose';

export const runtime = 'nodejs';

const clientId = process.env.SNAPTRADE_CLIENT_ID;
const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;

const snaptrade = clientId && consumerKey
  ? new Snaptrade({ clientId, consumerKey })
  : null;

/**
 * GET /api/snaptrade/accounts
 * List all connected SnapTrade accounts for the current user
 */
export async function GET(request: NextRequest) {
  try {
    if (!snaptrade || !clientId || !consumerKey) {
      return NextResponse.json(
        { error: 'SnapTrade is not configured' },
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

    // Get all SnapTrade connections for this user
    const connections = await BrokerConnection.find({
      userId: user._id,
      brokerType: 'snaptrade',
      isActive: true,
    }).lean();

    // Fetch account details from SnapTrade for each connection
    const accounts = [];
    for (const conn of connections) {
      if (!conn.snaptradeUserId || !conn.snaptradeAccountId) continue;

      try {
        const userSecret = conn.snaptradeUserSecret
          ? (await BrokerConnection.findById(conn._id as Types.ObjectId))?.getDecryptedSnaptradeUserSecret()
          : undefined;

        if (!userSecret) continue;

        // Get account details
        const accountResp = await snaptrade.accountInformation.getUserAccountPositions({
          userId: conn.snaptradeUserId,
          userSecret: userSecret,
          accountId: conn.snaptradeAccountId,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const accountData = (accountResp.data as any);

        accounts.push({
          id: (conn._id as Types.ObjectId).toString(),
          connectionId: conn.snaptradeConnectionId,
          accountId: conn.snaptradeAccountId,
          brokerName: conn.snaptradeBrokerName || 'Unknown',
          accountName: accountData?.account?.name || 'Unknown Account',
          accountNumber: accountData?.account?.number || '',
          buyingPower: accountData?.account?.buying_power || 0,
          // Add more account details as needed
        });
      } catch (error) {
        console.error(`Error fetching account ${conn.snaptradeAccountId}:`, error);
        // Include connection even if we can't fetch details
        accounts.push({
          id: (conn._id as Types.ObjectId).toString(),
          connectionId: conn.snaptradeConnectionId,
          accountId: conn.snaptradeAccountId,
          brokerName: conn.snaptradeBrokerName || 'Unknown',
          accountName: 'Unknown Account',
          accountNumber: '',
          buyingPower: 0,
        });
      }
    }

    return NextResponse.json({
      success: true,
      accounts,
    });
  } catch (error) {
    console.error('SnapTrade accounts error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
