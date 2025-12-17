import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { BrokerConnection, IBrokerConnection } from '@/models/BrokerConnection';
import { User } from '@/models/User';
import { createBroker } from '@/lib/brokers/factory';
import { z } from 'zod';
import { Types } from 'mongoose';

export const runtime = 'nodejs';

const brokerConnectionSchema = z.object({
  brokerType: z.enum(['alpaca', 'webull']),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  paperTrading: z.boolean().optional().default(true), // Default to paper trading for testing
  accountId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * GET /api/brokers
 * List user's connected brokers
 */
export async function GET() {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findOne({ whopUserId: userId, companyId: companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const connections = await BrokerConnection.find({
      userId: user._id,
    }).lean();

    // Return connections without encrypted fields
    const safeConnections = connections.map((conn) => ({
      id: (conn._id as Types.ObjectId).toString(),
      brokerType: conn.brokerType,
      isActive: conn.isActive,
      paperTrading: conn.paperTrading,
      accountId: conn.accountId,
      metadata: conn.metadata,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.error('Error fetching broker connections:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/brokers
 * Connect a new broker
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findOne({ whopUserId: userId, companyId: companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const validated = brokerConnectionSchema.parse(body);

    // Check if connection already exists for this broker type
    const existing = await BrokerConnection.findOne({
      userId: user._id,
      brokerType: validated.brokerType,
    });

    if (existing) {
      return NextResponse.json(
        { error: `You already have a ${validated.brokerType} connection. Please update or delete the existing one.` },
        { status: 400 }
      );
    }

    // Validate connection before saving
    const tempConnection = {
      userId: user._id,
      brokerType: validated.brokerType,
      apiKey: validated.apiKey,
      apiSecret: validated.apiSecret,
      isActive: true,
      paperTrading: validated.paperTrading,
      getDecryptedApiKey: () => validated.apiKey,
      getDecryptedApiSecret: () => validated.apiSecret,
      getDecryptedAccessToken: () => undefined,
    } as unknown as IBrokerConnection;

    try {
      const broker = createBroker(validated.brokerType, tempConnection);
      const accountInfo = await broker.getAccountInfo();

      // Create and save the connection (encryption happens in pre-save hook)
      const connection = await BrokerConnection.create({
        userId: user._id,
        brokerType: validated.brokerType,
        apiKey: validated.apiKey, // Will be encrypted by pre-save hook
        apiSecret: validated.apiSecret, // Will be encrypted by pre-save hook
        isActive: true,
        paperTrading: validated.paperTrading,
        accountId: accountInfo.accountId || validated.accountId,
        metadata: validated.metadata || {},
      });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection._id.toString(),
          brokerType: connection.brokerType,
          isActive: connection.isActive,
          paperTrading: connection.paperTrading,
          accountId: connection.accountId,
        },
        accountInfo,
      }, { status: 201 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid credentials';
      return NextResponse.json(
        { error: `Failed to validate connection: ${errorMessage}` },
        { status: 400 }
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error creating broker connection:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/brokers/:id
 * Update broker connection
 */
export async function PATCH(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findOne({ whopUserId: userId, companyId: companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('id');

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 });
    }

    const connection = await BrokerConnection.findOne({
      _id: connectionId,
      userId: user._id,
    });

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    const body = await request.json();
    const updateSchema = z.object({
      apiKey: z.string().min(1).optional(),
      apiSecret: z.string().min(1).optional(),
      paperTrading: z.boolean().optional(),
      isActive: z.boolean().optional(),
      metadata: z.record(z.unknown()).optional(),
    });

    const validated = updateSchema.parse(body);

    // If updating credentials, validate them first
    if (validated.apiKey || validated.apiSecret) {
      const testApiKey = validated.apiKey || connection.getDecryptedApiKey();
      const testApiSecret = validated.apiSecret || connection.getDecryptedApiSecret();

      const tempConnection = {
        userId: user._id,
        brokerType: connection.brokerType,
        apiKey: testApiKey,
        apiSecret: testApiSecret,
        isActive: true,
        paperTrading: validated.paperTrading ?? connection.paperTrading,
        getDecryptedApiKey: () => testApiKey,
        getDecryptedApiSecret: () => testApiSecret,
        getDecryptedAccessToken: () => connection.getDecryptedAccessToken(),
      } as unknown as IBrokerConnection;

      try {
        const broker = createBroker(connection.brokerType, tempConnection);
        await broker.validateConnection();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid credentials';
        return NextResponse.json(
          { error: `Failed to validate updated credentials: ${errorMessage}` },
          { status: 400 }
        );
      }
    }

    // Update fields
    if (validated.apiKey) connection.apiKey = validated.apiKey;
    if (validated.apiSecret) connection.apiSecret = validated.apiSecret;
    if (validated.paperTrading !== undefined) connection.paperTrading = validated.paperTrading;
    if (validated.isActive !== undefined) connection.isActive = validated.isActive;
    if (validated.metadata) connection.metadata = validated.metadata;

    await connection.save();

    return NextResponse.json({
      success: true,
      connection: {
        id: connection._id.toString(),
        brokerType: connection.brokerType,
        isActive: connection.isActive,
        paperTrading: connection.paperTrading,
        accountId: connection.accountId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error updating broker connection:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/brokers/:id
 * Disconnect broker
 */
export async function DELETE(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findOne({ whopUserId: userId, companyId: companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('id');

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 });
    }

    const connection = await BrokerConnection.findOne({
      _id: connectionId,
      userId: user._id,
    });

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    await connection.deleteOne();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting broker connection:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
