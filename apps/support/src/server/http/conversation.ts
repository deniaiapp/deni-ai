import type { ConversationBody } from '@/lib/support-protocol';
import { isConversationStoreEnabled, listMessages, readCredential } from '../conversations';
import { clientIp, rateLimit } from '../rate-limit';
import { errorResponse } from './shared';

/** The saved conversation for the `Authorization: Bearer <credential>` header. */
export async function GET(request: Request): Promise<Response> {
  if (!isConversationStoreEnabled()) return errorResponse('unavailable');

  const ip = clientIp(request);
  const retryAfter = rateLimit(`conversation:${ip}`, 120, 3_600_000);
  if (retryAfter) return errorResponse('rate_limited', retryAfter);

  const header = request.headers.get('authorization') ?? '';
  const id = readCredential(header.replace(/^Bearer\s+/i, ''));
  if (!id) return errorResponse('invalid');

  try {
    const body: ConversationBody = { messages: await listMessages(id) };
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[conversation] Could not load', error);
    return errorResponse('failed');
  }
}
