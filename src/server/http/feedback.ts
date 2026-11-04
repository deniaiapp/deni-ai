import { siteUrl } from '@/lib/shared';
import { supportLimits } from '@/lib/support-protocol';
import { isEmailConfigured, sendSupportEmail } from '../email';
import { clientIp, rateLimit } from '../rate-limit';
import { verifyTurnstile } from '../turnstile';
import {
  errorResponse,
  isEmail,
  optionalString,
  readJsonBody,
  readLanguage,
  readPagePath,
} from './shared';

export async function POST(request: Request): Promise<Response> {
  if (!isEmailConfigured()) return errorResponse('unavailable');

  const body = await readJsonBody(request, 32 * 1024);
  if (!body) return errorResponse('invalid');

  const lang = readLanguage(body.lang);
  const kind = body.kind;
  const helpful = body.helpful;
  const message = optionalString(body.message, supportLimits.messageLength);
  const email = optionalString(body.email, supportLimits.emailLength);
  const pagePath = readPagePath(body.pagePath);
  if (
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

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return errorResponse('verification_failed');
  }

  if (typeof body.website === 'string' && body.website.length > 0) {
    return Response.json({ ok: true });
  }

  const verdict = kind === 'page' ? (helpful ? 'Helpful' : 'Not helpful') : 'General';
  const text = [
    `Feedback: ${verdict}`,
    ...(pagePath ? [`Page: ${siteUrl}${pagePath}`] : []),
    `Language: ${lang}`,
    ...(email ? [`From: ${email}`] : []),
    `User agent: ${request.headers.get('user-agent') ?? 'unknown'}`,
    '',
    message ?? '(no comment)',
  ].join('\n');

  try {
    await sendSupportEmail({
      subject: `[Feedback] ${verdict}${pagePath ? `: ${pagePath}` : ''}`,
      text,
      replyTo: email,
    });
  } catch (error) {
    console.error('[feedback] Failed to send', error);
    return errorResponse('failed');
  }

  return Response.json({ ok: true });
}
