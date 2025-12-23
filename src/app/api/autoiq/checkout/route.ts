import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/autoiq/checkout
 * Returns the AutoIQ subscription checkout URL
 */
export async function GET() {
    try {
        const AUTOIQ_PLAN_ID = process.env.WHOP_AUTOIQ_PLAN_ID;

        if (!AUTOIQ_PLAN_ID) {
            return NextResponse.json(
                { checkoutUrl: 'https://whop.com/checkout/' },
                { status: 200 }
            );
        }

        const checkoutUrl = `https://whop.com/checkout/${AUTOIQ_PLAN_ID}`;

        return NextResponse.json({ checkoutUrl });
    } catch (error) {
        console.error('Error getting AutoIQ checkout URL:', error);
        return NextResponse.json(
            { checkoutUrl: 'https://whop.com/checkout/' },
            { status: 200 }
        );
    }
}

