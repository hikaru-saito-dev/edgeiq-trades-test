# Environment Variables Configuration

## Required Environment Variables

### MongoDB Configuration
```bash
MONGO_URI=mongodb://localhost:27017
MONGO_DB=trade-whop
```

### Whop API Configuration
```bash
# Whop API Key (required for Whop SDK operations)
WHOP_API_KEY=your_whop_api_key_here

# Whop App ID (required for Whop SDK)
NEXT_PUBLIC_WHOP_APP_ID=your_whop_app_id_here

# Whop Company ID (your main company/community ID)
NEXT_PUBLIC_WHOP_COMPANY_ID=your_company_id_here

# Whop Webhook Secret (REQUIRED for webhook signature verification)
# Get this from your Whop app settings -> Webhooks
# Format: whsec_xxxxxxxxxxxxx or just the secret without prefix
WHOP_WEBHOOK_SECRET=your_webhook_secret_here

# Whop Follow Product ID (required for follow purchase checkout)
# This is the Whop product ID that represents "follow plays"
WHOP_FOLLOW_PRODUCT_ID=your_follow_product_id_here

# Whop AutoIQ Plan ID (required for AutoIQ subscription detection)
# This is the existing Whop plan ID for AutoIQ subscriptions
# The plan already exists - you just need the plan ID
# IMPORTANT: If your AutoIQ plan doesn't have metadata, the webhook will detect
# AutoIQ payments by comparing plan_id to this value
WHOP_AUTOIQ_PLAN_ID=your_autoiq_plan_id_here
```

### SnapTrade Broker Integration
```bash
# SnapTrade Consumer Key (from SnapTrade dashboard)
SNAPTRADE_CONSUMER_KEY=your_snaptrade_consumer_key_here

# SnapTrade Client ID (from SnapTrade dashboard)
SNAPTRADE_CLIENT_ID=your_snaptrade_client_id_here
```

### Encryption
```bash
# Encryption key for sensitive data (broker secrets, etc.)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_32_byte_hex_encryption_key_here
```

## Optional Environment Variables (with defaults)

### MongoDB Connection Pool
```bash
# For high-volume traffic (Discord-scale)
MONGODB_MAX_POOL_SIZE=50
MONGODB_MIN_POOL_SIZE=5
MONGODB_READ_PREFERENCE=primary
```

### Cache Configuration
```bash
# User cache settings for in-memory LRU cache
USER_CACHE_MAX_SIZE=10000
USER_CACHE_TTL=300000
```

## Webhook Configuration

### Webhook Endpoint URL
The webhook endpoint URL that Whop will call:
```
https://yourdomain.com/api/webhooks/payment
```

**Important:** Set this in your Whop app settings -> Webhooks.

### Webhook Events Handled
- `payment.succeeded` - For successful payments (follow purchases & AutoIQ subscriptions)
- `payment.failed` - For failed payments
- Refunds - Detected via payment status: `refunded`, `partially_refunded`, `auto_refunded`

### Webhook Metadata Project Values
- `"trade_follow"` - For follow purchase payments
- `"trade_autoiq"` - For AutoIQ subscription payments

## Setup Instructions

1. Copy the required variables to your `.env.local` file for local development
2. For production, set these in your hosting platform's environment variables (Vercel, etc.)
3. **CRITICAL:** `WHOP_WEBHOOK_SECRET` must be kept secure and never committed to git
4. The webhook endpoint has been updated from `/api/follow_checkout` to `/api/webhooks/payment`

## Verification

To verify your webhook configuration:
1. Ensure `WHOP_WEBHOOK_SECRET` is set correctly
2. Configure the webhook URL in Whop app settings: `https://yourdomain.com/api/webhooks/payment`
3. Test with a follow purchase or AutoIQ subscription payment
4. Check server logs for webhook processing

