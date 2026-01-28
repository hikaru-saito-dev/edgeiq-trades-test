import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { getPusherServer, userChannel } from '@/lib/realtime/pusherServer';

export const runtime = 'nodejs';

function parseAuthBody(bodyText: string): { socket_id?: string; channel_name?: string } {
  // Pusher JS sends application/x-www-form-urlencoded by default.
  const params = new URLSearchParams(bodyText);
  const socket_id = params.get('socket_id') || undefined;
  const channel_name = params.get('channel_name') || undefined;
  if (socket_id || channel_name) return { socket_id, channel_name };

  // Fallback to JSON if needed.
  try {
    const json = JSON.parse(bodyText) as { socket_id?: string; channel_name?: string };
    return { socket_id: json.socket_id, channel_name: json.channel_name };
  } catch {
    return {};
  }
}

/**
 * POST /api/realtime/pusher/auth
 * Authorize Pusher private channel subscriptions.
 *
 * Security model:
 * - Each user may only subscribe to their own channel: private-user-{whopUserId}
 * - Auth uses the same headers as other API routes: x-user-id + x-company-id
 */
export async function POST(request: NextRequest) {
  const pusher = getPusherServer();
  if (!pusher) {
    return NextResponse.json({ error: 'Realtime not configured' }, { status: 503 });
  }

  await connectDB();
  const headers = await import('next/headers').then(m => m.headers());

  const userId = headers.get('x-user-id');
  const companyId = headers.get('x-company-id');

  if (!userId || !companyId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate user + membership (same pattern as other routes)
  const { getUserForCompany } = await import('@/lib/userHelpers');
  const userResult = await getUserForCompany(userId, companyId);
  if (!userResult || !userResult.membership || !userResult.user?.whopUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = await request.text();
  const { socket_id, channel_name } = parseAuthBody(raw);
  if (!socket_id || !channel_name) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Only allow subscribing to the user's own channel.
  const expected = userChannel(userResult.user.whopUserId);
  if (channel_name !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const auth = pusher.authorizeChannel(socket_id, channel_name);
  return NextResponse.json(auth);
}

