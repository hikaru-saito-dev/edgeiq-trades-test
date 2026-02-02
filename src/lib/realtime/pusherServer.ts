import Pusher from 'pusher';

let cached: Pusher | null | undefined;

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function getPusherServer(): Pusher | null {
  if (cached !== undefined) return cached;

  const appId = getEnv('PUSHER_APP_ID');
  // Reuse the same key/cluster env vars as the client to avoid duplicates.
  const key = getEnv('NEXT_PUBLIC_PUSHER_KEY');
  const secret = getEnv('PUSHER_SECRET');
  const cluster = getEnv('NEXT_PUBLIC_PUSHER_CLUSTER');

  if (!appId || !key || !secret || !cluster) {
    cached = null;
    return cached;
  }

  cached = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });

  return cached;
}

export function userChannel(whopUserId: string): string {
  return `private-user-${whopUserId}`;
}

async function triggerChannels(
  channels: string[],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const pusher = getPusherServer();
  if (!pusher) {
    return;
  }
  if (!channels.length) return;

  // Pusher limits trigger to 100 channels per call.
  const chunkSize = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < channels.length; i += chunkSize) {
    chunks.push(channels.slice(i, i + chunkSize));
  }

  // Send chunks concurrently (with a safe cap) so large follower lists don't take 1–2 minutes.
  const concurrency = Math.max(1, Math.min(10, parseInt(process.env.PUSHER_TRIGGER_CONCURRENCY || '4', 10) || 4));
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
    while (true) {
      const cur = idx++;
      const chunk = chunks[cur];
      if (!chunk) break;
      try {
        await pusher.trigger(chunk, event, payload);
        console.log('[Pusher] Batch event sent', { channels: chunk.length, event, firstChannel: chunk[0] });
      } catch (err) {
        console.error('[Pusher] triggerChannels failed', {
          event,
          channels: chunk.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  await Promise.all(workers);
}

export async function triggerUserEvent(
  whopUserId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const pusher = getPusherServer();
  if (!pusher) {
    return;
  }
  if (!whopUserId) return;

  const channel = userChannel(whopUserId);
  try {
    await pusher.trigger(channel, event, payload);
  } catch (err) {
    // Never break core flows (trade creation/settlement) due to realtime failures.
    console.error('[Pusher] triggerUserEvent failed', {
      channel,
      whopUserId,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function triggerUsersEvent(
  whopUserIds: string[],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const unique = [...new Set(whopUserIds.filter(Boolean))];
  const channels = unique.map(userChannel);
  await triggerChannels(channels, event, payload);
}

