import { siteUrl } from '@/lib/shared';
import { isContactCategory, supportLimits, type ContactCategory } from '@/lib/support-protocol';
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
  requiredString,
  verifyHuman,
} from './shared';

const categoryLabels: Record<ContactCategory, string> = {
  account: 'Account and sign-in',
  billing: 'Plans and billing',
  education: 'School email domain request',
  chat: 'Chat',
  flixa: 'Flixa',
  teams: 'Teams',
  bug: 'Bug report',
  privacy: 'Privacy and data',
  other: 'Other',
};

export async function POST(request: Request): Promise<Response> {
  if (!isEmailConfigured()) return errorResponse('unavailable');

  const body = await readJsonBody(request, 128 * 1024);
  if (!body) return errorResponse('invalid');

  const lang = readLanguage(body.lang);
  const name = optionalString(body.name, supportLimits.nameLength);
  const email = requiredString(body.email, supportLimits.emailLength);
  const subject = requiredString(body.subject, supportLimits.subjectLength);
  const message = requiredString(body.message, supportLimits.messageLength);
  const pagePath = readPagePath(body.pagePath);
  const transcript = readTranscript(body.transcript);
  if (
    transcript === null ||
    !lang ||
    name === null ||
    !email ||
    !isEmail(email) ||
    !isContactCategory(body.category) ||
    !subject ||
    !message ||
    pagePath === null
  ) {
    return errorResponse('invalid');
  }

  const ip = clientIp(request);
  const retryAfter = rateLimit(`contact:${ip}`, 5, 3_600_000);
  if (retryAfter) return errorResponse('rate_limited', retryAfter);

  if (!(await verifyHuman(body, ip))) return errorResponse('verification_failed');

  // Bots that fill the hidden field get a success response and nothing is sent.
  if (typeof body.website === 'string' && body.website.length > 0) {
    return Response.json({ ok: true });
  }

  const category = body.category;
  const conversationId = await openRequestConversation(body.conversation, { lang, pagePath });

  const text = [
    `Category: ${categoryLabels[category]}`,
    `From: ${name ? `${name} <${email}>` : email}`,
    `Language: ${lang}`,
    ...(pagePath ? [`Page: ${siteUrl}${pagePath}`] : []),
    `User agent: ${request.headers.get('user-agent') ?? 'unknown'}`,
    ...(transcript ? ['Sent from: AI support chat'] : []),
    // Replies from the admin page also show up in the visitor's chat.
    ...(conversationId ? [`Reply in the chat: ${adminLink(siteUrl, conversationId)}`] : []),
    '',
    `Subject: ${subject}`,
    '',
    message,
    ...(transcript ? ['', '--- AI support chat ---', '', formatTranscript(transcript)] : []),
  ].join('\n');

  const tag = transcript ? '[Support via chat]' : '[Support]';
  try {
    await sendSupportEmail({
      subject: `${tag} ${categoryLabels[category]}: ${subject}`,
      text,
      replyTo: email,
    });
  } catch (error) {
    console.error('[contact] Failed to send', error);
    return errorResponse('failed');
  }

  return Response.json(
    await saveRequest(conversationId, message, { kind: 'contact', category, subject, email }),
  );
}
