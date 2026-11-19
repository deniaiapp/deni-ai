import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { Mail, MessageSquareText } from 'lucide-react';
import { AdminShell, adminHead, formatDateTime } from '@/components/admin/admin-shell';
import { getAdminStatus, getInbox, isInboxFilter } from '@/lib/admin-api';
import { cn } from '@/lib/cn';
import type { InboxFilter } from '@/server/admin';

const filterLabels: Record<InboxFilter, string> = {
  waiting: '返信待ち',
  open: '対応中',
  closed: '完了',
  all: 'すべて',
};

export const Route = createFileRoute('/admin/')({
  validateSearch: (search: Record<string, unknown>): { filter?: InboxFilter } =>
    isInboxFilter(search.filter) ? { filter: search.filter } : {},
  beforeLoad: async () => {
    if (!(await getAdminStatus()).signedIn) throw redirect({ to: '/admin/login' });
  },
  loaderDeps: ({ search }) => ({ filter: search.filter ?? 'waiting' }),
  loader: async ({ deps }) => ({
    filter: deps.filter,
    items: await getInbox({ data: { filter: deps.filter } }),
  }),
  head: () => adminHead('受信箱'),
  component: AdminInbox,
});

function AdminInbox() {
  const { filter, items } = Route.useLoaderData();

  return (
    <AdminShell>
      <nav className="flex flex-wrap gap-2" aria-label="絞り込み">
        {(Object.keys(filterLabels) as InboxFilter[]).map((value) => (
          <Link
            key={value}
            to="/admin"
            search={value === 'waiting' ? {} : { filter: value }}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              value === filter ? 'bg-fd-primary text-fd-primary-foreground' : 'hover:bg-fd-accent',
            )}
          >
            {filterLabels[value]}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-sm text-fd-muted-foreground">該当する問い合わせはありません。</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/admin/c/$id"
                params={{ id: item.id }}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-fd-accent"
              >
                <span className="flex items-center gap-2 text-sm">
                  {item.request?.kind === 'feedback' ? (
                    <MessageSquareText className="size-4 shrink-0 text-fd-muted-foreground" />
                  ) : (
                    <Mail className="size-4 shrink-0 text-fd-muted-foreground" />
                  )}
                  <span className="min-w-0 truncate font-medium">
                    {item.request?.kind === 'contact' ? item.request.subject : 'フィードバック'}
                  </span>
                  {item.waiting && item.status === 'open' && (
                    <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
                      返信待ち
                    </span>
                  )}
                  {item.status === 'closed' && (
                    <span className="shrink-0 rounded-full bg-fd-muted px-2 py-0.5 text-xs text-fd-muted-foreground">
                      完了
                    </span>
                  )}
                  <span className="ms-auto shrink-0 text-xs text-fd-muted-foreground">
                    {formatDateTime(item.lastRequestAt)}
                  </span>
                </span>
                <span className="truncate text-sm text-fd-muted-foreground">{item.preview}</span>
                <span className="text-xs text-fd-muted-foreground">
                  {item.email ?? 'メールアドレスなし'} · {item.lang}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
