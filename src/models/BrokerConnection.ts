import mongoose, { Schema, Document, Types } from 'mongoose';
import { encrypt, decrypt } from '@/lib/encryption';

export type BrokerType = 'alpaca' | 'webull';

export interface IBrokerConnection extends Document {
  userId: Types.ObjectId;
  brokerType: BrokerType;
  apiKey: string; // Encrypted
  apiSecret: string; // Encrypted
  accessToken?: string; // Encrypted, optional - for OAuth flows
  accountId?: string; // Broker-specific account identifier
  isActive: boolean;
  paperTrading: boolean; // For Alpaca paper vs live trading
  metadata?: Record<string, unknown>; // Broker-specific config
  createdAt: Date;
  updatedAt: Date;
  // Decryption methods
  getDecryptedApiKey(): string;
  getDecryptedApiSecret(): string;
  getDecryptedAccessToken(): string | undefined;
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
    enum: ['alpaca', 'webull'],
    required: true,
    index: true,
  },
  apiKey: {
    type: String,
    required: true,
  },
  apiSecret: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
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
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Compound indexes
BrokerConnectionSchema.index({ userId: 1, brokerType: 1 }, { unique: true }); // One connection per broker type per user
BrokerConnectionSchema.index({ userId: 1, isActive: 1 });

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

export const BrokerConnection = (mongoose.models && mongoose.models.BrokerConnection) ||
  mongoose.model<IBrokerConnection>('BrokerConnection', BrokerConnectionSchema);
