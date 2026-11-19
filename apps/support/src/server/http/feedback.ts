import { siteUrl } from '@/lib/shared';
import { supportLimits } from '@/lib/support-protocol';
import { isEmailConfigured, sendSupportEmail } from '../email';
import { adminLink, openRequestConversation, saveRequest } from '../conversations';
import { clientIp, rateLimit } from '../rate-limit';
import {
  errorResponse,
  formatTranscript,
  isEmail,
  optionalString,
  readJsonBody,
  readLanguage,
  readPagePath,
  readTranscript,
  verifyHuman,
} from './shared';

export async function POST(request: Request): Promise<Response> {
  if (!isEmailConfigured()) return errorResponse('unavailable');

  const body = await readJsonBody(request, 128 * 1024);
  if (!body) return errorResponse('invalid');

  const lang = readLanguage(body.lang);
  const kind = body.kind;
  const helpful = body.helpful;
  const message = optionalString(body.message, supportLimits.messageLength);
  const email = optionalString(body.email, supportLimits.emailLength);
  const pagePath = readPagePath(body.pagePath);
  const transcript = readTranscript(body.transcript);
  if (
    transcript === null ||
    !lang ||
    (kind !== 'page' && kind !== 'general') ||
    message === null ||
    email === null ||
    (email !== undefined && !isEmail(email)) ||
    pagePath === null
  ) {
    return errorResponse('invalid');
  }
  if (kind === 'page' && (typeof helpful !== 'boolean' || !pagePath)) {
    return errorResponse('invalid');
  }
  if (kind === 'general' && !message) return errorResponse('invalid');

  const ip = clientIp(request);
  const retryAfter = rateLimit(`feedback:${ip}`, 10, 3_600_000);
  if (retryAfter) return errorResponse('rate_limited', retryAfter);

  if (!(await verifyHuman(body, ip))) return errorResponse('verification_failed');

  if (typeof body.website === 'string' && body.website.length > 0) {
    return Response.json({ ok: true });
  }

  // General feedback comes from the widget, where the team can reply in the chat;
  // page ratings are anonymous.
  const conversationId =
    kind === 'general'
      ? await openRequestConversation(body.conversation, { lang, pagePath })
      : undefined;

  const verdict = kind === 'page' ? (helpful ? 'Helpful' : 'Not helpful') : 'General';
  const text = [
    `Feedback: ${verdict}`,
    ...(pagePath ? [`Page: ${siteUrl}${pagePath}`] : []),
    `Language: ${lang}`,
    ...(email ? [`From: ${email}`] : []),
    `User agent: ${request.headers.get('user-agent') ?? 'unknown'}`,
    ...(transcript ? ['Sent from: AI support chat'] : []),
    ...(conversationId ? [`Reply in the chat: ${adminLink(siteUrl, conversationId)}`] : []),
    '',
    message ?? '(no comment)',
    ...(transcript ? ['', '--- AI support chat ---', '', formatTranscript(transcript)] : []),
  ].join('\n');

  const tag = transcript ? '[Feedback via chat]' : '[Feedback]';
  try {
    await sendSupportEmail({
      subject: `${tag} ${verdict}${pagePath ? `: ${pagePath}` : ''}`,
      text,
      replyTo: email,
    });
  } catch (error) {
    console.error('[feedback] Failed to send', error);
    return errorResponse('failed');
  }

  if (!message) return Response.json({ ok: true });
  return Response.json(await saveRequest(conversationId, message, { kind: 'feedback', email }));
}
