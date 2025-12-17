import mongoose, { Schema, Document, Types } from 'mongoose';
import { encrypt, decrypt } from '@/lib/encryption';

export type BrokerType = 'alpaca' | 'webull' | 'snaptrade';

export interface IBrokerConnection extends Document {
  userId: Types.ObjectId;
  brokerType: BrokerType;
  // Direct API credentials (for Alpaca, Webull direct)
  apiKey?: string; // Encrypted - for direct API brokers
  apiSecret?: string; // Encrypted - for direct API brokers
  accessToken?: string; // Encrypted, optional - for OAuth flows
  accessTokenExpiresAt?: Date; // When the access token expires
  accountId?: string; // Broker-specific account identifier
  // SnapTrade credentials (for SnapTrade-connected brokers)
  snaptradeUserId?: string; // SnapTrade user ID (not encrypted, it's a public identifier)
  snaptradeUserSecret?: string; // Encrypted - SnapTrade user secret
  snaptradeAccountId?: string; // SnapTrade account ID for this specific account
  snaptradeConnectionId?: string; // SnapTrade connection UUID
  snaptradeBrokerName?: string; // Broker name (e.g., 'webull', 'alpaca') when connected via SnapTrade
  isActive: boolean;
  paperTrading: boolean; // For Alpaca paper vs live trading
  metadata?: Record<string, unknown>; // Broker-specific config
  createdAt: Date;
  updatedAt: Date;
  // Decryption methods
  getDecryptedApiKey(): string;
  getDecryptedApiSecret(): string;
  getDecryptedAccessToken(): string | undefined;
  getDecryptedSnaptradeUserSecret(): string | undefined;
}

const BrokerConnectionSchema = new Schema<IBrokerConnection>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  brokerType: {
    type: String,
    enum: ['alpaca', 'webull', 'snaptrade'],
    required: true,
    index: true,
  },
  apiKey: {
    type: String,
    required: false, // Not required for SnapTrade
  },
  apiSecret: {
    type: String,
    required: false, // Not required for SnapTrade
  },
  accessToken: {
    type: String,
    required: false,
  },
  accessTokenExpiresAt: {
    type: Date,
    required: false,
  },
  accountId: {
    type: String,
    required: false,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  paperTrading: {
    type: Boolean,
    default: true, // Default to paper trading for testing
  },
  // SnapTrade-specific fields
  snaptradeUserId: {
    type: String,
    required: false,
  },
  snaptradeUserSecret: {
    type: String,
    required: false,
  },
  snaptradeAccountId: {
    type: String,
    required: false,
  },
  snaptradeConnectionId: {
    type: String,
    required: false,
  },
  snaptradeBrokerName: {
    type: String,
    required: false, // e.g., 'webull', 'alpaca' when connected via SnapTrade
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Compound indexes
// For direct API brokers (alpaca, webull), one connection per broker type per user
// For SnapTrade, multiple accounts per user are allowed (different accountId)
BrokerConnectionSchema.index({ userId: 1, brokerType: 1, accountId: 1 }, { unique: true });
BrokerConnectionSchema.index({ userId: 1, isActive: 1 });
BrokerConnectionSchema.index({ userId: 1, snaptradeAccountId: 1 });

// Helper to check if a string is already encrypted
// Encrypted values are base64 and have a specific minimum length (salt + iv + tag + encrypted data)
function isEncrypted(value: string): boolean {
  if (!value) return false;
  // Encrypted values are base64, minimum length is ENCRYPTED_POSITION (96 bytes) + some encrypted data
  // Check if it's valid base64 and has minimum expected length
  try {
    const decoded = Buffer.from(value, 'base64');
    // Minimum encrypted size: SALT_LENGTH (64) + IV_LENGTH (16) + TAG_LENGTH (16) + at least some encrypted data
    return decoded.length >= 100; // Encrypted data should be at least this long
  } catch {
    return false;
  }
}

// Encrypt before saving (only if not already encrypted)
BrokerConnectionSchema.pre('save', function (next) {
  if (this.isModified('apiKey') && this.apiKey && !isEncrypted(this.apiKey)) {
    try {
      this.apiKey = encrypt(this.apiKey);
    } catch (error) {
      return next(error as Error);
    }
  }
  if (this.isModified('apiSecret') && this.apiSecret && !isEncrypted(this.apiSecret)) {
    try {
      this.apiSecret = encrypt(this.apiSecret);
    } catch (error) {
      return next(error as Error);
    }
  }
  if (this.isModified('accessToken') && this.accessToken && !isEncrypted(this.accessToken)) {
    try {
      this.accessToken = encrypt(this.accessToken);
    } catch (error) {
      return next(error as Error);
    }
  }
  if (this.isModified('snaptradeUserSecret') && this.snaptradeUserSecret && !isEncrypted(this.snaptradeUserSecret)) {
    try {
      this.snaptradeUserSecret = encrypt(this.snaptradeUserSecret);
    } catch (error) {
      return next(error as Error);
    }
  }
  // Note: accessTokenExpiresAt is not encrypted (it's just a date)
  next();
});

// Decrypt after loading (add virtual or method)
BrokerConnectionSchema.methods.getDecryptedApiKey = function (): string {
  try {
    return decrypt(this.apiKey);
  } catch {
    return '';
  }
};

BrokerConnectionSchema.methods.getDecryptedApiSecret = function (): string {
  try {
    return decrypt(this.apiSecret);
  } catch {
    return '';
  }
};

BrokerConnectionSchema.methods.getDecryptedAccessToken = function (): string | undefined {
  if (!this.accessToken) return undefined;
  try {
    return decrypt(this.accessToken);
  } catch {
    return undefined;
  }
};

BrokerConnectionSchema.methods.getDecryptedSnaptradeUserSecret = function (): string | undefined {
  if (!this.snaptradeUserSecret) return undefined;
  try {
    return decrypt(this.snaptradeUserSecret);
  } catch {
    return undefined;
  }
};

export const BrokerConnection = (mongoose.models && mongoose.models.BrokerConnection) ||
  mongoose.model<IBrokerConnection>('BrokerConnection', BrokerConnectionSchema);
