// Server functions behind the admin inbox. Every handler checks the admin session
// itself; route guards only decide what to render.

import { createServerFn } from '@tanstack/react-start';
import type { ConversationDetail, InboxFilter, InboxItem } from '@/server/admin';
import { supportLimits } from './support-protocol';

const filters: readonly InboxFilter[] = ['waiting', 'open', 'closed', 'all'];

export function isInboxFilter(value: unknown): value is InboxFilter {
  return (filters as readonly unknown[]).includes(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readId(data: unknown): string {
  const id = (data as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new Error('Invalid conversation');
  return id;
}

async function admin() {
  const session = await import('@/server/admin-session');
  session.requireAdmin();
  return import('@/server/admin');
}

/** Whether the inbox is configured, and whether this browser is signed in. */
export const getAdminStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const { isAdminEnabled, hasAdminSession } = await import('@/server/admin-session');
  return { enabled: isAdminEnabled(), signedIn: hasAdminSession() };
});

export const adminSignIn = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({
    password: typeof data?.password === 'string' ? data.password.slice(0, 500) : '',
  }))
  .handler(async ({ data }) => {
    const [{ isAdminPassword, startAdminSession }, { clientIp, rateLimit }, { getRequest }] =
      await Promise.all([
        import('@/server/admin-session'),
        import('@/server/rate-limit'),
        import('@tanstack/react-start/server'),
      ]);
    if (rateLimit(`admin-login:${clientIp(getRequest())}`, 10, 900_000)) {
      return { ok: false as const, error: 'rate_limited' as const };
    }
    if (!isAdminPassword(data.password)) return { ok: false as const, error: 'wrong' as const };
    startAdminSession();
    return { ok: true as const };
  });

export const adminSignOut = createServerFn({ method: 'POST' }).handler(async () => {
  const { endAdminSession } = await import('@/server/admin-session');
  endAdminSession();
  return { ok: true };
});

export const getInbox = createServerFn({ method: 'GET' })
  .validator((data: { filter?: string }) => ({
    filter: isInboxFilter(data?.filter) ? data.filter : ('waiting' as InboxFilter),
  }))
  .handler(async ({ data }): Promise<InboxItem[]> => (await admin()).listInbox(data.filter));

export const getAdminConversation = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => ({ id: readId(data) }))
  .handler(
    async ({ data }): Promise<ConversationDetail | null> =>
      (await admin()).getConversationDetail(data.id),
  );

export const replyAsStaff = createServerFn({ method: 'POST' })
  .validator((data: { id: string; content: string }) => {
    const content = typeof data?.content === 'string' ? data.content.trim() : '';
    if (!content || content.length > supportLimits.messageLength) throw new Error('Invalid reply');
    return { id: readId(data), content };
  })
  .handler(async ({ data }) => (await admin()).replyToConversation(data.id, data.content));

export const setAdminConversationStatus = createServerFn({ method: 'POST' })
  .validator((data: { id: string; status: string }): { id: string; status: 'open' | 'closed' } => {
    const status = data?.status;
    if (status !== 'open' && status !== 'closed') throw new Error('Invalid status');
    return { id: readId(data), status };
  })
  .handler(async ({ data }) => {
    await (await admin()).setConversationStatus(data.id, data.status);
    return { ok: true };
  });
