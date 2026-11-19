// Admin inbox queries and the team's replies. Callers check the admin session first.

import { and, desc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { resolveLanguage } from '@/lib/i18n';
import { siteUrl } from '@/lib/shared';
import type { ConversationMessage, SentRequest } from '@/lib/support-protocol';
import { appendMessages, conversationLink, listMessages } from './conversations';
import { getDb } from './db';
import { conversation, message, type ConversationStatus } from './db/schema';
import { isEmailConfigured, sendSupportEmail } from './email';
import { serverEnv } from './env';

export type InboxFilter = 'waiting' | 'open' | 'closed' | 'all';

export type InboxItem = {
  id: string;
  lang: string;
  email: string | null;
  status: ConversationStatus;
  /** The latest contact or feedback message. */
  request: SentRequest | null;
  preview: string;
  lastRequestAt: string;
  lastStaffReplyAt: string | null;
  /** The visitor wrote after the team's last reply (or the team hasn't replied). */
  waiting: boolean;
};

export async function listInbox(filter: InboxFilter): Promise<InboxItem[]> {
  const db = getDb();
  const waiting = or(
    isNull(conversation.lastStaffReplyAt),
    gt(conversation.lastRequestAt, conversation.lastStaffReplyAt),
  );
  const where = and(
    isNotNull(conversation.lastRequestAt),
    filter === 'waiting'
      ? and(eq(conversation.status, 'open'), waiting)
      : filter === 'open' || filter === 'closed'
        ? eq(conversation.status, filter)
        : undefined,
  );

  // The latest request message of each conversation, for the subject and preview.
  const latestRequest = db
    .selectDistinctOn([message.conversationId], {
      conversationId: message.conversationId,
      content: message.content,
      request: message.request,
    })
    .from(message)
    .where(isNotNull(message.request))
    .orderBy(message.conversationId, desc(message.createdAt))
    .as('latest_request');

  const rows = await db
    .select({
      id: conversation.id,
      lang: conversation.lang,
      email: conversation.email,
      status: conversation.status,
      lastRequestAt: conversation.lastRequestAt,
      lastStaffReplyAt: conversation.lastStaffReplyAt,
      content: latestRequest.content,
      request: latestRequest.request,
      waiting: sql<boolean>`coalesce(${waiting}, false)`,
    })
    .from(conversation)
    .leftJoin(latestRequest, eq(latestRequest.conversationId, conversation.id))
    .where(where)
    .orderBy(desc(conversation.lastRequestAt))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    lang: row.lang,
    email: row.email,
    status: row.status,
    request: row.request ?? null,
    preview: (row.content ?? '').replace(/\s+/g, ' ').slice(0, 160),
    lastRequestAt: row.lastRequestAt!.toISOString(),
    lastStaffReplyAt: row.lastStaffReplyAt?.toISOString() ?? null,
    waiting: Boolean(row.waiting),
  }));
}

export type ConversationDetail = {
  id: string;
  lang: string;
  email: string | null;
  status: ConversationStatus;
  pagePath: string | null;
  createdAt: string;
  messages: ConversationMessage[];
};

export async function getConversationDetail(id: string): Promise<ConversationDetail | null> {
  const [row] = await getDb().select().from(conversation).where(eq(conversation.id, id));
  if (!row) return null;
  return {
    id: row.id,
    lang: row.lang,
    email: row.email,
    status: row.status,
    pagePath: row.pagePath,
    createdAt: row.createdAt.toISOString(),
    messages: await listMessages(id),
  };
}

export async function setConversationStatus(id: string, status: ConversationStatus) {
  await getDb().update(conversation).set({ status }).where(eq(conversation.id, id));
}

const replyEmail = {
  en: {
    subject: 'Reply from Deni AI Support',
    intro: 'The Deni AI Support team replied to your message.',
    open: 'See the conversation and reply in the help center chat:',
    note: 'You can also reply to this email.',
  },
  ja: {
    subject: '【Deni AI サポート】お問い合わせへの返信',
    intro: 'Deni AI サポートからお問い合わせへの返信がありました。',
    open: 'ヘルプセンターのチャットで会話を確認し、返信できます：',
    note: 'このメールに直接返信していただくこともできます。',
  },
} as const;

/**
 * Saves the team's reply, which the visitor sees in the widget, and emails it to
 * the conversation's address with a link back to the chat. Resolves whether the
 * email went out.
 */
export async function replyToConversation(id: string, content: string): Promise<{ emailed: boolean }> {
  const [row] = await getDb().select().from(conversation).where(eq(conversation.id, id));
  if (!row) throw new Error('Conversation not found');

  await appendMessages(id, [{ role: 'staff', content }]);
  // A reply usually settles the request; the visitor writing again reopens it.
  await setConversationStatus(id, 'closed');

  if (!row.email || !isEmailConfigured()) return { emailed: false };
  const lang = resolveLanguage(row.lang);
  const t = replyEmail[lang];
  try {
    await sendSupportEmail({
      to: row.email,
      replyTo: serverEnv.supportEmailTo,
      subject: t.subject,
      text: [
        t.intro,
        '',
        content,
        '',
        '---',
        t.open,
        conversationLink(siteUrl, lang, id),
        '',
        t.note,
      ].join('\n'),
    });
    return { emailed: true };
  } catch (error) {
    console.error('[admin] Could not email the reply', error);
    return { emailed: false };
  }
}
