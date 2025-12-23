import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { Company } from '@/models/Company';
import { User } from '@/models/User';

export const runtime = 'nodejs';

/**
 * GET /api/autoiq/checkout
 * Returns the AutoIQ subscription checkout URL with affiliate code
 */
export async function GET() {
    try {
        await connectDB();

        const headers = await import('next/headers').then(m => m.headers());
        const companyId = headers.get('x-company-id');

        const AUTOIQ_PLAN_ID = process.env.WHOP_AUTOIQ_PLAN_ID;

        if (!AUTOIQ_PLAN_ID) {
            return NextResponse.json(
                { checkoutUrl: 'https://whop.com/checkout/' },
                { status: 200 }
            );
        }

        let checkoutUrl = `https://whop.com/checkout/${AUTOIQ_PLAN_ID}`;

        // Add affiliate code if company owner is found
        if (companyId) {
            try {
                const company = await Company.findOne({ companyId });
                if (company && company.companyOwnerWhopUserId) {
                    const owner = await User.findOne({ whopUserId: company.companyOwnerWhopUserId });
                    if (owner) {
                        // Use whopUsername, whopDisplayName, or fallback to a default
                        const affiliateCode = owner.whopUsername || owner.whopDisplayName || 'companyowner';

                        // Remove all existing query parameters and add only ?a=username
                        const url = new URL(checkoutUrl);
                        url.search = ''; // Clear all existing query parameters

                        // Remove trailing slash from pathname
                        url.pathname = url.pathname.replace(/\/$/, '');

                        // Add affiliate code
                        url.searchParams.set('a', affiliateCode);
                        checkoutUrl = url.toString();
                    }
                }
            } catch (error) {
                // If affiliate code lookup fails, continue with base URL
                console.error('Error getting company owner for affiliate code:', error);
            }
        }

        return NextResponse.json({ checkoutUrl });
    } catch (error) {
        console.error('Error getting AutoIQ checkout URL:', error);
        return NextResponse.json(
            { checkoutUrl: 'https://whop.com/checkout/' },
            { status: 200 }
        );
    }
}

