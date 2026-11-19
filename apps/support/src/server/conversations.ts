// Saved support widget conversations. A visitor holds a credential
// (`<uuid>.<token>`); the token is an HMAC of the ID, so nothing secret is stored
// and the team's reply emails can link back to the conversation.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Language } from '@/lib/i18n';
import type {
  ConversationMessage,
  SentRequest,
  SupportSentBody,
} from '@/lib/support-protocol';
import { getDb } from './db';
import { conversation, message, type MessageRole } from './db/schema';
import { serverEnv } from './env';

/** Saving needs the database and a secret to sign conversation credentials with. */
export function isConversationStoreEnabled(): boolean {
  return Boolean(serverEnv.databaseUrl && serverEnv.supportSecret);
}

function tokenFor(id: string): string {
  return createHmac('sha256', `support-conversation:${serverEnv.supportSecret}`)
    .update(id)
    .digest('base64url');
}

export function credentialFor(id: string): string {
  return `${id}.${tokenFor(id)}`;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The conversation ID a credential grants, or undefined when it is not genuine. */
export function readCredential(value: unknown): string | undefined {
  if (!isConversationStoreEnabled() || typeof value !== 'string' || value.length > 200) {
    return undefined;
  }
  const [id, token] = value.split('.');
  if (!id || !token || !uuidPattern.test(id)) return undefined;
  const expected = Buffer.from(tokenFor(id));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : undefined;
}

/** Link that opens the conversation in the widget, e.g. from a reply email. */
export function conversationLink(siteUrl: string, lang: Language, id: string): string {
  // In the fragment, so the credential never reaches server or proxy logs.
  return `${siteUrl}/${lang}#support-conversation=${credentialFor(id)}`;
}

export async function createConversation(options: {
  lang: Language;
  pagePath?: string;
}): Promise<string> {
  const [row] = await getDb()
    .insert(conversation)
    .values({ lang: options.lang, pagePath: options.pagePath })
    .returning({ id: conversation.id });
  return row!.id;
}

/** The credential's conversation if it still exists, otherwise a new one. */
export async function resolveConversation(
  credential: unknown,
  options: { lang: Language; pagePath?: string },
): Promise<string> {
  const id = readCredential(credential);
  if (id) {
    const [row] = await getDb()
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.id, id));
    if (row) return row.id;
  }
  return createConversation(options);
}

type NewMessage = {
  role: MessageRole;
  content: string;
  request?: SentRequest;
  sources?: { title: string; url: string }[];
};

function toConversationMessage(row: typeof message.$inferSelect): ConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    ...(row.request ? { request: row.request } : {}),
    ...(row.sources?.length ? { sources: row.sources } : {}),
  };
}

/** Appends messages in order; a request reopens the conversation in the admin inbox. */
export async function appendMessages(
  conversationId: string,
  messages: NewMessage[],
): Promise<ConversationMessage[]> {
  if (messages.length === 0) return [];
  const now = Date.now();
  const rows = await getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(message)
      .values(
        messages.map((m, i) => ({
          conversationId,
          role: m.role,
          content: m.content,
          request: m.request,
          sources: m.sources?.length ? m.sources : undefined,
          // Distinct timestamps keep the order stable when sorting by time.
          createdAt: new Date(now + i),
        })),
      )
      .returning();

    const request = messages.filter((m) => m.request).at(-1)?.request;
    const staff = messages.some((m) => m.role === 'staff');
    await tx
      .update(conversation)
      .set({
        updatedAt: new Date(now),
        ...(request
          ? {
              lastRequestAt: new Date(now),
              status: 'open' as const,
              ...(request.email ? { email: request.email } : {}),
            }
          : {}),
        ...(staff ? { lastStaffReplyAt: new Date(now) } : {}),
      })
      .where(eq(conversation.id, conversationId));
    return inserted;
  });
  return rows.map(toConversationMessage);
}

/**
 * The conversation a contact or feedback message from the widget is saved to, or
 * undefined when saving is off or the database is unavailable (the email still goes).
 */
export async function openRequestConversation(
  credential: unknown,
  options: { lang: Language; pagePath?: string },
): Promise<string | undefined> {
  if (!isConversationStoreEnabled()) return undefined;
  try {
    return await resolveConversation(credential, options);
  } catch (error) {
    console.error('[conversations] Could not open the conversation', error);
    return undefined;
  }
}

/** Saves a message sent to the team, for the success response of the form endpoints. */
export async function saveRequest(
  conversationId: string | undefined,
  content: string,
  request: SentRequest,
): Promise<SupportSentBody> {
  if (!conversationId) return { ok: true };
  try {
    const [saved] = await appendMessages(conversationId, [{ role: 'user', content, request }]);
    return { ok: true, conversation: credentialFor(conversationId), message: saved };
  } catch (error) {
    console.error('[conversations] Could not save the request', error);
    return { ok: true };
  }
}

/** Admin page of a conversation, linked from the team's notification emails. */
export function adminLink(siteUrl: string, conversationId: string): string {
  return `${siteUrl}/admin/c/${conversationId}`;
}

export async function listMessages(conversationId: string): Promise<ConversationMessage[]> {
  const rows = await getDb()
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt));
  return rows.map(toConversationMessage);
}
