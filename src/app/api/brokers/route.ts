import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { BrokerConnection, IBrokerConnection } from '@/models/BrokerConnection';
import { User } from '@/models/User';
import { createBroker } from '@/lib/brokers/factory';
import { z } from 'zod';
import { Types } from 'mongoose';

export const runtime = 'nodejs';

const brokerConnectionSchema = z.object({
  brokerType: z.enum(['snaptrade']), // Only SnapTrade is supported
  apiKey: z.string().optional(), // Not used for SnapTrade
  apiSecret: z.string().optional(), // Not used for SnapTrade
  paperTrading: z.boolean().optional().default(false), // SnapTrade accounts are typically live
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

    // Only SnapTrade connections are allowed - users connect via the login modal
    // Direct API broker connections (Alpaca, Webull) are not supported
    if (validated.brokerType !== 'snaptrade') {
      return NextResponse.json(
        { error: 'Only SnapTrade connections are supported. Please use the SnapTrade login modal to connect your broker account.' },
        { status: 400 }
      );
    }

    // SnapTrade connections are created via the callback route, not here
    return NextResponse.json(
      { error: 'SnapTrade connections must be created through the connection portal. Use /api/snaptrade/portal to start the connection flow.' },
      { status: 400 }
    );
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
      paperTrading: z.boolean().optional(),
      isActive: z.boolean().optional(),
      metadata: z.record(z.unknown()).optional(),
    });

    const validated = updateSchema.parse(body);

    // SnapTrade connections cannot be updated via API - credentials are managed through SnapTrade portal
    if (connection.brokerType === 'snaptrade') {
      // Only allow updating paperTrading, isActive, and metadata
      if (validated.paperTrading !== undefined) connection.paperTrading = validated.paperTrading;
      if (validated.isActive !== undefined) connection.isActive = validated.isActive;
      if (validated.metadata) connection.metadata = validated.metadata;
    } else {
      // Legacy direct API connections - allow updates but warn they're deprecated
      return NextResponse.json(
        { error: 'Direct API broker connections are deprecated. Please reconnect via SnapTrade login modal.' },
        { status: 400 }
      );
    }

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
