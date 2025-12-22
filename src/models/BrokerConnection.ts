import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBrokerConnection extends Document {
    userId: Types.ObjectId;
    whopUserId: string; // Whop user ID for person-level tracking
    brokerType: 'snaptrade';
    isActive: boolean;

    // SnapTrade specific fields
    snaptradeUserId: string; // SnapTrade user ID
    snaptradeUserSecret: string; // Encrypted user secret
    authorizationId?: string; // Brokerage authorization ID
    accountId?: string; // Selected account ID (if multiple accounts)

    // Account information (cached)
    brokerName?: string;
    accountName?: string;
    accountNumber?: string;
    buyingPower?: number;

    // Connection metadata
    connectedAt: Date;
    lastSyncedAt?: Date;
    expiresAt?: Date; // When the connection expires (if applicable)

    createdAt: Date;
    updatedAt: Date;
}

const BrokerConnectionSchema = new Schema<IBrokerConnection>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    whopUserId: { type: String, required: true, index: true },
    brokerType: { type: String, enum: ['snaptrade'], required: true, default: 'snaptrade' },
    isActive: { type: Boolean, default: true, index: true },

    // SnapTrade fields
    snaptradeUserId: { type: String, required: true },
    snaptradeUserSecret: { type: String, required: true }, // Should be encrypted
    authorizationId: { type: String },
    accountId: { type: String },

    // Account info
    brokerName: { type: String },
    accountName: { type: String },
    accountNumber: { type: String },
    buyingPower: { type: Number },

    // Metadata
    connectedAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date },
    expiresAt: { type: Date },
}, {
    timestamps: true,
});

// Compound indexes
BrokerConnectionSchema.index({ userId: 1, isActive: 1 });
BrokerConnectionSchema.index({ whopUserId: 1, isActive: 1 });
BrokerConnectionSchema.index({ brokerType: 1, isActive: 1 });
BrokerConnectionSchema.index({ snaptradeUserId: 1 }, { unique: true, sparse: true });

export const BrokerConnection = (mongoose.models && mongoose.models.BrokerConnection) ||
    mongoose.model<IBrokerConnection>('BrokerConnection', BrokerConnectionSchema);

