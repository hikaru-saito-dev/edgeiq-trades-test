import { NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';
import crypto from 'crypto';
import connectDB from '@/lib/db';
import { CompanyMembership, User } from '@/models/User';
import { FollowPurchase } from '@/models/FollowPurchase';

const WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET;
const AUTOIQ_PLAN_ID = process.env.WHOP_AUTOIQ_PLAN_ID;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface WhopWebhookPayload {
  data: {
    id: string; // Payment ID for payment webhooks, Refund ID for refund webhooks
    user_id?: string;
    plan_id?: string;
    company_id?: string;
    status?: string;
    payment_id?: string; // For refund webhooks, this is the original payment ID
    payment?: {
      id: string;
      plan_id?: string;
      company_id?: string;
      user_id?: string;
      status?: string;
      metadata?: {
        followPurchase?: boolean;
        capperUserId?: string;
        capperCompanyId?: string;
        numPlays?: number | string;
        project?: string;
      };
      checkout_configuration?: {
        metadata?: Record<string, unknown>;
      };
    };
    metadata?: {
      followPurchase?: boolean;
      capperUserId?: string;
      capperCompanyId?: string;
      numPlays?: number | string;
      project?: string;
    };
  };
  api_version: string;
  action: string;
}

/**
 * Verify Whop webhook signature
 * Format: x-whop-signature: t=timestamp,v1=signature
 */
function verifyWhopSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    // Parse signature: t=timestamp,v1=signature
    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const signaturePart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) {
      console.error('Webhook signature: Missing timestamp or v1 part', { signature });
      return false;
    }

    const timestamp = timestampPart.split('=')[1];
    const receivedSignature = signaturePart.split('=')[1];

    if (!timestamp || !receivedSignature) {
      console.error('Webhook signature: Empty timestamp or signature', { timestamp, receivedSignature });
      return false;
    }

    // Create signed payload: timestamp.payload
    const signedPayload = `${timestamp}.${payload}`;

    // Compute HMAC SHA256
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(signedPayload);
    const computedSignature = hmac.digest('hex');

    // Compare signatures using timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(receivedSignature, 'hex'),
      Buffer.from(computedSignature, 'hex')
    );

    if (!isValid) {
      console.error('Webhook signature mismatch', {
        receivedLength: receivedSignature.length,
        computedLength: computedSignature.length,
        timestamp,
      });
    }

    return isValid;
  } catch (error) {
    console.error('Webhook signature verification error:', error);
    return false;
  }
}

/**
 * Webhook handler for Whop payment events
 * Handles app-level webhooks with x-whop-signature header
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!WEBHOOK_SECRET) {
      console.error('WHOP_WEBHOOK_SECRET environment variable is required for webhook verification');
      return new Response('Server misconfigured', { status: 500 });
    }

    // Get raw request body as text (required for signature verification)
    const requestBodyText = await request.text();

    if (!requestBodyText || requestBodyText.length === 0) {
      return new Response('Empty request body', { status: 400 });
    }

    // Get signature header
    const signature = request.headers.get('x-whop-signature');

    if (!signature) {
      console.error('Webhook: Missing x-whop-signature header');
      return new Response('Missing x-whop-signature header', { status: 401 });
    }

    // Verify webhook signature
    // Strip whsec_ prefix if present (Whop webhook secret format)
    const secret = WEBHOOK_SECRET?.startsWith('whsec_')
      ? WEBHOOK_SECRET.slice(6)
      : WEBHOOK_SECRET || '';

    if (!secret) {
      console.error('Webhook: WHOP_WEBHOOK_SECRET is not configured');
      return new Response('Server misconfigured', { status: 500 });
    }

    const isValidSignature = verifyWhopSignature(
      requestBodyText,
      signature,
      secret
    );

    if (!isValidSignature) {
      console.error('Webhook: Invalid signature', {
        hasSecret: !!WEBHOOK_SECRET,
        signatureLength: signature.length,
        payloadLength: requestBodyText.length,
      });
      return new Response('Invalid webhook signature', { status: 401 });
    }

    // Parse webhook payload
    let webhookPayload: WhopWebhookPayload;
    try {
      webhookPayload = JSON.parse(requestBodyText) as WhopWebhookPayload;
    } catch {
      return new Response('Invalid JSON payload', { status: 400 });
    }

    // Handle payment events
    // Whop can send either "payment.succeeded" or "app_payment.succeeded"
    if (
      webhookPayload.action === 'payment.succeeded' ||
      webhookPayload.action === 'app_payment.succeeded'
    ) {
      // Process async
      waitUntil(handlePaymentSucceeded(webhookPayload.data));
    } else if (
      webhookPayload.action === 'payment.failed' ||
      webhookPayload.action === 'app_payment.failed'
    ) {
      // Process async
      waitUntil(handlePaymentFailed(webhookPayload.data));
    } else if (
      webhookPayload.action === 'payment.refunded' ||
      webhookPayload.action === 'refund.created' ||
      webhookPayload.action === 'app_payment.refunded'
    ) {
      // Handle refund as separate webhook event
      waitUntil(handlePaymentRefunded(webhookPayload.data));
    }

    // Return 200 OK quickly to prevent webhook retries
    // Return JSON response for compatibility
    return Response.json({ success: true }, { status: 200 });
  } catch {
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Process payment succeeded webhook
 * Runs asynchronously via waitUntil to avoid blocking the response
 */
async function handlePaymentSucceeded(paymentData: WhopWebhookPayload['data']): Promise<void> {
  try {
    await connectDB();

    const planId = paymentData.plan_id;
    if (!planId) {
      return;
    }

    // Fallback: Check for refund status (in case refunds still come as payment.succeeded with refund status)
    // This is a backwards compatibility check - refunds should come as separate webhook events
    if (
      paymentData.status === 'refunded' ||
      paymentData.status === 'partially_refunded' ||
      paymentData.status === 'auto_refunded'
    ) {
      // Route to refund handler (already in waitUntil context)
      await handlePaymentRefunded(paymentData);
      return;
    }

    // Only process paid payments (refunds are handled separately via refund webhook events)
    if (paymentData.status !== 'paid') {
      return;
    }

    // Extract metadata from payment data - check multiple possible locations
    // Whop stores metadata in different places depending on the webhook structure
    let metadata: Record<string, unknown> = {};

    // Try direct metadata first
    if (paymentData.metadata && typeof paymentData.metadata === 'object') {
      metadata = paymentData.metadata as Record<string, unknown>;
    }

    // If empty, try nested locations
    if (!metadata || Object.keys(metadata).length === 0) {
      const paymentObj = paymentData as unknown as {
        checkout_configuration?: {
          metadata?: Record<string, unknown>;
        };
        plan?: {
          metadata?: Record<string, unknown>;
        };
      };

      metadata = paymentObj.checkout_configuration?.metadata ||
        paymentObj.plan?.metadata ||
        {};
    }

    // Fallback: If metadata is still empty, check plan_id to determine payment type
    if ((!metadata || Object.keys(metadata).length === 0) && planId) {
      // Check if this is the AutoIQ plan (plan doesn't have metadata)
      if (AUTOIQ_PLAN_ID && planId === AUTOIQ_PLAN_ID) {
        // This is an AutoIQ subscription payment
        metadata = {
          project: 'trade_autoiq',
        };
      } else {
        // Try to look up as follow purchase plan
        try {
          const { getUserByFollowOfferPlanId } = await import('@/lib/userHelpers');
          const capperResult = await getUserByFollowOfferPlanId(planId);

          if (capperResult && capperResult.user && capperResult.membership) {
            // Reconstruct metadata from user's follow offer settings
            metadata = {
              followPurchase: true,
              project: 'trade_follow',
              capperUserId: String(capperResult.user._id),
              capperCompanyId: capperResult.membership.companyId || paymentData.company_id,
              numPlays: capperResult.membership.followOfferNumPlays || 10,
            };
          } else {
            // User not found or follow offer disabled
            console.error('[FollowPurchase] User lookup failed for plan:', planId, {
              userFound: !!capperResult,
              followEnabled: capperResult?.membership?.followOfferEnabled,
            });
          }
        } catch (lookupError) {
          // If lookup fails, log the error
          console.error('[FollowPurchase] Error looking up user by plan_id:', planId, lookupError);
        }
      }
    }

    // Extract project type from metadata
    const project = metadata.project as string | undefined;

    // Route by project type
    if (project === 'trade_follow') {
      // Handle follow purchase
      await handleFollowPurchase(paymentData, metadata);
    } else if (project === 'trade_autoiq') {
      // Handle AutoIQ subscription
      await handleAutoIQSubscription(paymentData);
    } else {
      // Unknown project type or missing metadata
      if (planId && (!metadata || Object.keys(metadata).length === 0)) {
        console.error('[Payment] Missing metadata for plan:', planId, paymentData);
      } else if (project) {
        console.error('[Payment] Unknown project type:', project, paymentData);
      }
      return;
    }
  } catch {
    // Silent fail - webhook already returned 200 OK
  }
}

/**
 * Handle follow purchase payment
 */
async function handleFollowPurchase(
  paymentData: WhopWebhookPayload['data'],
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await connectDB();

    const planId = paymentData.plan_id;
    if (!planId) {
      return;
    }

    // Only process follow purchase webhooks
    if (!metadata || !metadata.followPurchase) {
      return;
    }

    const capperUserId = metadata.capperUserId;
    const capperCompanyId = metadata.capperCompanyId || paymentData.company_id;

    // Handle numPlays as either number or string
    const numPlaysRaw =
      typeof metadata.numPlays === 'string'
        ? parseInt(metadata.numPlays, 10)
        : (typeof metadata.numPlays === 'number' ? metadata.numPlays : undefined);

    // Ensure numPlays is a valid positive number
    const numPlays = (numPlaysRaw && typeof numPlaysRaw === 'number' && numPlaysRaw > 0) ? numPlaysRaw : 10;
    const followerWhopUserId = paymentData.user_id;
    const paymentId = paymentData.id;

    // Validate required fields
    if (!capperUserId || !capperCompanyId || !followerWhopUserId || !paymentId) {
      return;
    }

    // Check if we already processed this payment (prevent duplicates)
    // Use findOne with paymentId (which has unique index) to prevent race conditions
    const existingPurchase = await FollowPurchase.findOne({
      paymentId: paymentId,
    });

    if (existingPurchase) {
      // Payment already processed - idempotent success
      return;
    }

    // Find the follower user (the person who purchased)
    // Search by whopUserId only - follower might be in a different company
    // Try to find any user record with this whopUserId
    const followerUser = await User.findOne({
      whopUserId: followerWhopUserId,
    });

    // If not found, the user might not exist yet (they should exist if they logged in)
    if (!followerUser || !followerUser.whopUserId) {
      return;
    }

    // Find the capper (content creator being followed)
    // capperUserId might be MongoDB ObjectId (from metadata) or whopUserId (from query params)
    // Try ObjectId first, then fallback to whopUserId
    let capperUser = null;
    try {
      // Try as ObjectId first (from metadata created in checkout)
      const mongoose = await import('mongoose');
      if (mongoose.Types.ObjectId.isValid(capperUserId as string)) {
        capperUser = await User.findById(capperUserId);
      }
    } catch {
      // Not a valid ObjectId, continue to whopUserId lookup
    }

    // If not found by ObjectId, try whopUserId
    if (!capperUser) {
      capperUser = await User.findOne({ whopUserId: capperUserId });
    }

    if (!capperUser || !capperUser.whopUserId) {
      return;
    }

    // Verify follow offer is still enabled - check in membership
    // Need to find the membership that has followOfferEnabled
    const { getUserForCompany } = await import('@/lib/userHelpers');
    if (capperCompanyId && typeof capperCompanyId === 'string') {
      const capperResult = await getUserForCompany(capperUser.whopUserId, capperCompanyId);
      if (!capperResult?.membership?.followOfferEnabled) {
        return;
      }
    } else {
      // Fallback: check if any membership has followOfferEnabled
      const hasFollowOffer = capperUser.companyMemberships?.some(
        (m: CompanyMembership) => m.followOfferEnabled
      );
      if (!hasFollowOffer) {
        return;
      }
    }

    // Verify follower is not trying to follow themselves (by whopUserId - person level)
    if (followerUser.whopUserId === capperUser.whopUserId) {
      return;
    }

    // Check if follower already has an active follow purchase for this capper (by whopUserId - person level)
    // This prevents duplicate follows across all companies for the same person
    const existingActiveFollow = await FollowPurchase.findOne({
      followerWhopUserId: followerUser.whopUserId,
      capperWhopUserId: capperUser.whopUserId,
      status: 'active',
    });

    if (existingActiveFollow) {
      return; // Already has an active follow
    }

    // Create follow purchase record
    // Use capperCompanyId for the companyId field (the company being followed)
    // Use create with try-catch to handle unique constraint violations (race condition protection)
    try {
      const followPurchase = new FollowPurchase({
        followerUserId: followerUser._id,
        capperUserId: capperUser._id,
        followerWhopUserId: followerUser.whopUserId,
        capperWhopUserId: capperUser.whopUserId,
        companyId: capperCompanyId, // Company of the capper being followed
        numPlaysPurchased: numPlays,
        numPlaysConsumed: 0,
        status: 'active',
        planId: planId,
        paymentId: paymentId,
      });

      await followPurchase.save();

      // Invalidate follow cache for the follower
      const { invalidateFollowCache } = await import('@/lib/cache/followCache');
      invalidateFollowCache(followerUser.whopUserId);
    } catch (saveError: unknown) {
      // Handle duplicate key error (race condition - another webhook processed this payment)
      if (saveError && typeof saveError === 'object' && 'code' in saveError && saveError.code === 11000) {
        // Duplicate key error - payment already processed by another webhook call
        // This is idempotent - return silently
        return;
      }
      // Re-throw other errors
      throw saveError;
    }
  } catch {
    // Silent fail - webhook already returned 200 OK
  }
}

/**
 * Handle AutoIQ subscription payment
 */
async function handleAutoIQSubscription(paymentData: WhopWebhookPayload['data']): Promise<void> {
  try {
    await connectDB();

    const followerWhopUserId = paymentData.user_id;
    const paymentId = paymentData.id;

    if (!followerWhopUserId || !paymentId) {
      return;
    }

    // Find the user
    const user = await User.findOne({
      whopUserId: followerWhopUserId,
    });

    if (!user || !user.whopUserId) {
      return;
    }

    // Check if already processed (idempotency)
    // We can check if user already has AutoIQ enabled for this payment
    // For now, just set it - idempotent operation
    user.hasAutoIQ = true;
    await user.save();
  } catch {
    // Silent fail - webhook already returned 200 OK
  }
}

/**
 * Handle payment failed webhook
 */
async function handlePaymentFailed(paymentData: WhopWebhookPayload['data']): Promise<void> {
  try {
    await connectDB();

    const planId = paymentData.plan_id;
    if (!planId) {
      return;
    }

    // Extract metadata from payment data
    let metadata: Record<string, unknown> = {};

    // Try direct metadata first
    if (paymentData.metadata && typeof paymentData.metadata === 'object') {
      metadata = paymentData.metadata as Record<string, unknown>;
    }

    // If empty, try nested locations
    if (!metadata || Object.keys(metadata).length === 0) {
      const paymentObj = paymentData as unknown as {
        checkout_configuration?: {
          metadata?: Record<string, unknown>;
        };
        plan?: {
          metadata?: Record<string, unknown>;
        };
      };

      metadata = paymentObj.checkout_configuration?.metadata ||
        paymentObj.plan?.metadata ||
        {};
    }

    const project = metadata.project as string | undefined;

    // Log failed payment
    console.error('[Payment] Payment failed:', {
      paymentId: paymentData.id,
      userId: paymentData.user_id,
      planId: planId,
      project: project,
    });

    // No action needed for failed payments
    // Follow purchase not created, AutoIQ subscription not activated
  } catch {
    // Silent fail - webhook already returned 200 OK
  }
}

/**
 * Handle payment refunded webhook
 */
async function handlePaymentRefunded(paymentData: WhopWebhookPayload['data']): Promise<void> {
  try {
    await connectDB();

    // For refund webhooks, payment_id is in data.payment_id (not data.id which is the refund ID)
    // Also check data.payment.id as fallback
    const paymentId = paymentData.payment_id || paymentData.payment?.id || paymentData.id;
    const followerWhopUserId = paymentData.payment?.user_id || paymentData.user_id;
    const planId = paymentData.payment?.plan_id || paymentData.plan_id;
    const companyId = paymentData.payment?.company_id || paymentData.company_id;

    if (!paymentId || !followerWhopUserId) {
      console.error('[Refund] Missing paymentId or followerWhopUserId', {
        paymentId,
        followerWhopUserId,
        refundId: paymentData.id,
        hasPayment: !!paymentData.payment,
        hasPaymentId: !!paymentData.payment_id,
      });
      return;
    }

    // Extract metadata from payment data
    // For refund webhooks, metadata might be in data.payment.metadata
    let metadata: Record<string, unknown> = {};

    // Try direct metadata first
    if (paymentData.metadata && typeof paymentData.metadata === 'object') {
      metadata = paymentData.metadata as Record<string, unknown>;
    }

    // Try payment.metadata (for refund webhooks)
    if ((!metadata || Object.keys(metadata).length === 0) && paymentData.payment?.metadata) {
      metadata = paymentData.payment.metadata as Record<string, unknown>;
    }

    // If empty, try nested locations (checkout_configuration)
    if (!metadata || Object.keys(metadata).length === 0) {
      if (paymentData.payment?.checkout_configuration?.metadata) {
        metadata = paymentData.payment.checkout_configuration.metadata as Record<string, unknown>;
      } else {
        const paymentObj = paymentData as unknown as {
          checkout_configuration?: {
            metadata?: Record<string, unknown>;
          };
          plan?: {
            metadata?: Record<string, unknown>;
          };
        };

        metadata = paymentObj.checkout_configuration?.metadata ||
          paymentObj.plan?.metadata ||
          {};
      }
    }

    // Fallback: If metadata is still empty, check plan_id to determine payment type
    if ((!metadata || Object.keys(metadata).length === 0) && planId) {
      // Check if this is the AutoIQ plan (plan doesn't have metadata)
      if (AUTOIQ_PLAN_ID && planId === AUTOIQ_PLAN_ID) {
        // This is an AutoIQ subscription payment
        metadata = {
          project: 'trade_autoiq',
        };
      } else {
        // Try to look up as follow purchase plan
        try {
          const { getUserByFollowOfferPlanId } = await import('@/lib/userHelpers');
          const capperResult = await getUserByFollowOfferPlanId(planId);

          if (capperResult && capperResult.user && capperResult.membership) {
            // Reconstruct metadata from user's follow offer settings
            metadata = {
              followPurchase: true,
              project: 'trade_follow',
              capperUserId: String(capperResult.user._id),
              capperCompanyId: capperResult.membership.companyId || companyId,
              numPlays: capperResult.membership.followOfferNumPlays || 10,
            };
          }
        } catch (lookupError) {
          // If lookup fails, log the error
          console.error('[Payment] Error looking up user by plan_id for refund:', planId, lookupError);
        }
      }
    }

    const project = metadata.project as string | undefined;

    if (project === 'trade_follow') {
      // Handle follow purchase refund
      
      const existingPurchase = await FollowPurchase.findOne({
        $or: [
          { paymentId: paymentId },
          { followerWhopUserId: followerWhopUserId, planId: planId },
        ],
      });

      if (existingPurchase && existingPurchase.status !== 'refunded') {
        existingPurchase.status = 'refunded';
        await existingPurchase.save();

        // Invalidate follow cache for the follower
        const { invalidateFollowCache } = await import('@/lib/cache/followCache');
        invalidateFollowCache(followerWhopUserId);
      }
    } else if (project === 'trade_autoiq') {
      // Handle AutoIQ subscription refund
      const user = await User.findOne({
        whopUserId: followerWhopUserId,
      });

      if (user && user.hasAutoIQ) {
        user.hasAutoIQ = false;
        await user.save();
      }
    }
  } catch {
    // Silent fail - webhook already returned 200 OK
  }
}

