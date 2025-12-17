import { NextRequest, NextResponse } from 'next/server';
import { Snaptrade } from 'snaptrade-typescript-sdk';

export const runtime = 'nodejs';

const clientId = process.env.SNAPTRADE_CLIENT_ID;
const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;

const snaptrade = clientId && consumerKey ? new Snaptrade({ clientId, consumerKey }) : null;

/**
 * GET /api/snaptrade/brokerages
 * Returns the official SnapTrade brokerage list (name + slug).
 *
 * We use this so the frontend always uses the correct broker slug
 * (e.g. "ALPACA", "WEBULL_US", etc.) when creating a Connection Portal session.
 */
export async function GET(_request: NextRequest) {
  try {
    if (!snaptrade || !clientId || !consumerKey) {
      return NextResponse.json({ error: 'SnapTrade is not configured' }, { status: 500 });
    }

    // The SDK method name follows the OpenAPI operationId: ReferenceData_listAllBrokerages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (snaptrade as any).referenceData.listAllBrokerages();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brokerages = (resp?.data as any[]) || [];

    return NextResponse.json({
      success: true,
      brokerages: brokerages.map((b) => ({
        // The API uses `slug` as the "broker" parameter in loginSnapTradeUser
        slug: (b?.slug ?? '') as string,
        name: (b?.name ?? b?.display_name ?? b?.brokerage_name ?? b?.slug ?? '') as string,
        // Optional fields (may or may not exist depending on API version)
        logoUrl: (b?.logo_url ?? b?.logoUrl ?? b?.logo ?? null) as string | null,
        brokerageType: (b?.brokerage_type ?? b?.type ?? null) as string | null,
      })),
    });
  } catch (error) {
    console.error('SnapTrade brokerages error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load brokerages' }, { status: 500 });
  }
}

