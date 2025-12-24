import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Whop from '@whop/sdk';
import { z } from 'zod';

export const runtime = 'nodejs';

const WHOP_API_KEY = process.env.WHOP_API_KEY || '';
const EDGEIQ_COMPANY_ID = process.env.NEXT_PUBLIC_WHOP_COMPANY_ID || '';
// Product ID in Whop that represents the "follow plays" product
// You must set this in your environment (server-side) configuration.
const WHOP_FOLLOW_PRODUCT_ID = process.env.WHOP_FOLLOW_PRODUCT_ID || '';

// Reuse a single Whop client instance across requests
const whopClient = new Whop({
  apiKey: WHOP_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const headers = await import('next/headers').then(m => m.headers());
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate input with Zod schema
    const checkoutSchema = z.object({
      priceCents: z.number().int().positive('Price must be a positive number'),
      numPlays: z.number().int().positive('Number of plays must be a positive integer').max(1000, 'Number of plays cannot exceed 1000'),
      capperUsername: z.string().min(1, 'Capper username is required'),
    });

    let validated;
    try {
      validated = checkoutSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    const { priceCents, numPlays, capperUsername } = validated;

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    const { getUserForCompany } = await import('@/lib/userHelpers');
    const capperResult = await getUserForCompany(userId, companyId);
    if (!capperResult || !capperResult.membership) {
      return NextResponse.json({ error: 'Capper user not found' }, { status: 404 });
    }
    const { user: capper, membership } = capperResult;

    if (membership.role !== 'companyOwner' && membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only company owners can create follow offers' },
        { status: 403 }
      );
    }

    const capperIdString = String(capper._id);

    if (!WHOP_API_KEY || !EDGEIQ_COMPANY_ID || !WHOP_FOLLOW_PRODUCT_ID) {
      return NextResponse.json(
        { error: 'Whop configuration missing on server' },
        { status: 500 }
      );
    }

    // Create (or recreate) a Whop plan for this capper's follow offer.
    // Then create a checkout configuration with metadata so webhooks can
    // identify which project/capper this payment is for.
    // Whop API requires title to be max 30 characters
    const maxTitleLength = 30;
    // Build title: "Follow {username} - {numPlays} plays"
    // If too long, truncate username while keeping the rest
    const suffix = ` - ${numPlays} plays`;
    const prefix = 'Follow ';
    const availableLength = maxTitleLength - prefix.length - suffix.length;
    const truncatedUsername = capperUsername.length > availableLength
      ? capperUsername.substring(0, Math.max(1, availableLength - 3)) + '...'
      : capperUsername;
    const planTitle = `${prefix}${truncatedUsername}${suffix}`.substring(0, maxTitleLength);

    const plan = await whopClient.plans.create({
      company_id: EDGEIQ_COMPANY_ID,
      product_id: WHOP_FOLLOW_PRODUCT_ID,
      initial_price: priceCents,
      plan_type: 'one_time',
      currency: 'usd',
      title: planTitle,
    });

    const planId = plan.id;

    // Attach metadata via a checkout configuration so that every resulting
    // payment includes project/capper information.
    const checkoutConfig = await whopClient.checkoutConfigurations.create({
      plan_id: planId,
      affiliate_code: capperUsername,
      metadata: {
        followPurchase: true,
        project: 'trade_follow',
        capperUserId: capperIdString,
        capperCompanyId: membership.companyId || companyId,
        numPlays,
      },
    });

    const purchaseUrl = checkoutConfig.purchase_url;

    if (!planId || !purchaseUrl) {
      return NextResponse.json(
        { error: 'Invalid checkout response from Whop' },
        { status: 500 }
      );
    }

    // Remove all existing query parameters, remove trailing slash, and add only ?a=username
    const url = new URL(purchaseUrl);
    url.search = ''; // Clear all existing query parameters (including session)

    // Remove trailing slash from pathname
    url.pathname = url.pathname.replace(/\/$/, '');

    // Add affiliate code
    url.searchParams.set('a', capperUsername);
    const finalCheckoutUrl = url.toString();

    // Always update with new plan_id - each capper gets unique plan_id
    const { updateCompanyMembership } = await import('@/lib/userHelpers');
    await updateCompanyMembership(userId, companyId, {
      followOfferEnabled: true,
      followOfferPriceCents: priceCents,
      followOfferNumPlays: numPlays,
      followOfferPlanId: planId, // Unique plan_id per capper
      followOfferCheckoutUrl: finalCheckoutUrl,
    });

    return NextResponse.json({
      success: true,
      planId: planId,
      checkoutUrl: finalCheckoutUrl,
    });
  } catch (error) {
    console.error('Error creating follow checkout:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

