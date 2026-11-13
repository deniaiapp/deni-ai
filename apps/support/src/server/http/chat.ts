import Anthropic from '@anthropic-ai/sdk';
import {
  supportConversationHeader,
  supportLimits,
  supportSessionHeader,
  type ChatEvent,
  type ChatTurn,
  type SupportErrorCode,
} from '@/lib/support-protocol';
import {
  appendMessages,
  credentialFor,
  isConversationStoreEnabled,
  resolveConversation,
} from '../conversations';
import { clientIp, rateLimit } from '../rate-limit';
import { isSupportAgentEnabled, runSupportAgent } from '../support-agent';
import { issueSupportSession, verifySupportSession } from '../support-session';
import { isTurnstileEnabled, verifyTurnstile } from '../turnstile';
import { errorResponse, readJsonBody, readLanguage, readPagePath } from './shared';

function readTurns(value: unknown): ChatTurn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > supportLimits.chatMessages) {
    return null;
  }

  let total = 0;
  const turns: ChatTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    const text = content.trim();
    if (!text || text.length > supportLimits.chatMessageLength) return null;
    total += text.length;
    turns.push({ role, content: text });
  }

  if (total > supportLimits.chatTotalLength) return null;
  // The conversation starts and ends with the user, alternating in between.
  if (turns[0]!.role !== 'user' || turns.at(-1)!.role !== 'user') return null;
  if (turns.some((turn, i) => i > 0 && turn.role === turns[i - 1]!.role)) return null;
  return turns;
}

function errorCodeFor(error: unknown): SupportErrorCode {
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (error instanceof Anthropic.APIError && (error.status === 529 || error.status === 503)) {
    return 'unavailable';
  }
  return 'failed';
}

export async function POST(request: Request): Promise<Response> {
  if (!isSupportAgentEnabled()) return errorResponse('unavailable');

  const body = await readJsonBody(request, 128 * 1024);
  const lang = readLanguage(body?.lang);
  const turns = readTurns(body?.messages);
  const pagePath = readPagePath(body?.pagePath);
  if (!body || !lang || !turns || pagePath === null) return errorResponse('invalid');

  const ip = clientIp(request);
  const retryAfter =
    rateLimit(`chat:minute:${ip}`, 6, 60_000) || rateLimit(`chat:day:${ip}`, 100, 86_400_000);
  if (retryAfter) return errorResponse('rate_limited', retryAfter);

  // A valid session pass stands in for a fresh Turnstile token.
  const hasSession = isTurnstileEnabled() && verifySupportSession(body.session);
  if (!hasSession && !(await verifyTurnstile(body.turnstileToken, ip))) {
    return errorResponse('verification_failed');
  }
  const session = isTurnstileEnabled() ? issueSupportSession() : undefined;

  // Saving is best effort: the chat still answers when the database is down.
  let conversationId: string | undefined;
  if (isConversationStoreEnabled()) {
    try {
      conversationId = await resolveConversation(body.conversation, { lang, pagePath });
    } catch (error) {
      console.error('[support-chat] Could not open the conversation', error);
    }
  }
  let answer = '';
  const sources: { title: string; url: string }[] = [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        if (event.type === 'text') answer += event.text;
        if (event.type === 'source') sources.push({ title: event.title, url: event.url });
        if (request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await runSupportAgent({ lang, turns, pagePath, signal: request.signal, emit });
        emit({ type: 'done' });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error('[support-chat] Agent failed', error);
          emit({ type: 'error', code: errorCodeFor(error) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnected client.
        }
        if (conversationId) {
          await appendMessages(conversationId, [
            { role: 'user', content: turns.at(-1)!.content },
            ...(answer.trim() ? [{ role: 'assistant' as const, content: answer, sources }] : []),
          ]).catch((error: unknown) =>
            console.error('[support-chat] Could not save the exchange', error),
          );
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      ...(session ? { [supportSessionHeader]: session } : {}),
      ...(conversationId ? { [supportConversationHeader]: credentialFor(conversationId) } : {}),
    },
  });
}
