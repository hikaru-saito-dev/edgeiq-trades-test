import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { BrokerConnection } from '@/models/BrokerConnection';
import { User } from '@/models/User';

export const runtime = 'nodejs';

/**
 * DELETE /api/snaptrade/disconnect
 * Disconnect a broker connection by setting isActive to false
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

        // Find user with company membership
        const { getUserForCompany } = await import('@/lib/userHelpers');
        if (!companyId) {
            return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
        }
        const userResult = await getUserForCompany(userId, companyId);
        if (!userResult || !userResult.membership) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const { user } = userResult;

        // Get connection ID from query params
        const { searchParams } = new URL(request.url);
        const connectionId = searchParams.get('connectionId');

        if (!connectionId) {
            return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 });
        }

        // Find and deactivate the connection
        await BrokerConnection.deleteOne({
            _id: connectionId,
            userId: user._id,
        });

        // Invalidate broker cache
        const { invalidateBrokerCache } = await import('@/lib/cache/brokerCache');
        invalidateBrokerCache(user.whopUserId, String(user._id));

        // If user has AutoIQ enabled and is in auto-trade mode, automatically switch to notify-only
        if (user.hasAutoIQ && user.autoTradeMode === 'auto-trade') {
            // Check if this was their default broker connection
            const wasDefaultBroker = user.defaultBrokerConnectionId &&
                String(user.defaultBrokerConnectionId) === connectionId;

            // Check if they have any other active broker connections
            const otherActiveConnections = await BrokerConnection.countDocuments({
                userId: user._id,
                isActive: true,
                brokerType: 'snaptrade',
            });

            // If this was their default broker OR they have no other active connections,
            // switch to notify-only mode
            if (wasDefaultBroker || otherActiveConnections === 0) {
                user.autoTradeMode = 'notify-only';
                if (wasDefaultBroker) {
                    user.defaultBrokerConnectionId = undefined;
                }
                await user.save();
            }
        }

        return NextResponse.json({ success: true, message: 'Broker connection disconnected successfully' });
    } catch (error) {
        console.error('Error disconnecting broker:', error);
        return NextResponse.json({ error: 'Failed to disconnect broker connection' }, { status: 500 });
    }
}
