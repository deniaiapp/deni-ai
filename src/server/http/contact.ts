import { siteUrl } from '@/lib/shared';
import { contactCategories, supportLimits, type ContactCategory } from '@/lib/support-protocol';
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
  requiredString,
} from './shared';

const categoryLabels: Record<ContactCategory, string> = {
  account: 'Account and sign-in',
  billing: 'Plans and billing',
  chat: 'Chat',
  flixa: 'Flixa',
  teams: 'Teams',
  bug: 'Bug report',
  privacy: 'Privacy and data',
  other: 'Other',
};

function isCategory(value: unknown): value is ContactCategory {
  return (contactCategories as readonly unknown[]).includes(value);
}

export async function POST(request: Request): Promise<Response> {
  if (!isEmailConfigured()) return errorResponse('unavailable');

  const body = await readJsonBody(request, 32 * 1024);
  if (!body) return errorResponse('invalid');

  const lang = readLanguage(body.lang);
  const name = optionalString(body.name, supportLimits.nameLength);
  const email = requiredString(body.email, supportLimits.emailLength);
  const subject = requiredString(body.subject, supportLimits.subjectLength);
  const message = requiredString(body.message, supportLimits.messageLength);
  const pagePath = readPagePath(body.pagePath);
  if (
    !lang ||
    name === null ||
    !email ||
    !isEmail(email) ||
    !isCategory(body.category) ||
    !subject ||
    !message ||
    pagePath === null
  ) {
    return errorResponse('invalid');
  }

  const ip = clientIp(request);
  const retryAfter = rateLimit(`contact:${ip}`, 5, 3_600_000);
  if (retryAfter) return errorResponse('rate_limited', retryAfter);

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return errorResponse('verification_failed');
  }

  // Bots that fill the hidden field get a success response and nothing is sent.
  if (typeof body.website === 'string' && body.website.length > 0) {
    return Response.json({ ok: true });
  }

  const text = [
    `Category: ${categoryLabels[body.category]}`,
    `From: ${name ? `${name} <${email}>` : email}`,
    `Language: ${lang}`,
    ...(pagePath ? [`Page: ${siteUrl}${pagePath}`] : []),
    `User agent: ${request.headers.get('user-agent') ?? 'unknown'}`,
    '',
    `Subject: ${subject}`,
    '',
    message,
  ].join('\n');

  try {
    await sendSupportEmail({
      subject: `[Support] ${categoryLabels[body.category]}: ${subject}`,
      text,
      replyTo: email,
    });
  } catch (error) {
    console.error('[contact] Failed to send', error);
    return errorResponse('failed');
  }

  return Response.json({ ok: true });
}
