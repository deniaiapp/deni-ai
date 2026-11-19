import { createFileRoute, Link, notFound, redirect, useRouter } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { ArrowLeft, Bot, Loader2, Mail, MessageSquareText, Send, User, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AdminShell, adminHead, formatDateTime } from '@/components/admin/admin-shell';
import { contactCategoryLabel } from '@/components/support-forms';
import {
  getAdminConversation,
  getAdminStatus,
  replyAsStaff,
  setAdminConversationStatus,
} from '@/lib/admin-api';
import { cn } from '@/lib/cn';
import { siteUrl } from '@/lib/shared';
import { supportLimits, type ConversationMessage } from '@/lib/support-protocol';

export const Route = createFileRoute('/admin/c/$id')({
  beforeLoad: async () => {
    if (!(await getAdminStatus()).signedIn) throw redirect({ to: '/admin/login' });
  },
  loader: async ({ params }) => {
    const detail = await getAdminConversation({ data: { id: params.id } }).catch(() => null);
    if (!detail) throw notFound();
    return detail;
  },
  head: () => adminHead('問い合わせ'),
  component: AdminConversation,
});

const roleLabels: Record<ConversationMessage['role'], string> = {
  user: 'ユーザー',
  assistant: 'AI アシスタント',
  staff: 'サポート担当',
};

function MessageItem({ message }: { message: ConversationMessage }) {
  const Icon = message.role === 'staff' ? UserRound : message.role === 'assistant' ? Bot : User;
  const request = message.request;

  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border px-4 py-3',
        request && 'border-fd-primary/40 bg-fd-primary/5',
        message.role === 'staff' && 'bg-fd-accent/60',
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-xs text-fd-muted-foreground">
        <Icon className="size-3.5" />
        <span className="font-medium">{roleLabels[message.role]}</span>
        {request?.kind === 'contact' && (
          <span className="inline-flex items-center gap-1">
            <Mail className="size-3.5" />
            お問い合わせ（{contactCategoryLabel('ja', request.category)}）
          </span>
        )}
        {request?.kind === 'feedback' && (
          <span className="inline-flex items-center gap-1">
            <MessageSquareText className="size-3.5" />
            フィードバック
          </span>
        )}
        <span className="ms-auto">{formatDateTime(message.createdAt)}</span>
      </p>
      {request?.kind === 'contact' && <p className="text-sm font-medium">{request.subject}</p>}
      <p className="whitespace-pre-wrap wrap-anywhere text-sm">{message.content}</p>
      {message.sources && message.sources.length > 0 && (
        <p className="text-xs text-fd-muted-foreground">
          参照: {message.sources.map((source) => source.title).join('、')}
        </p>
      )}
    </li>
  );
}

function AdminConversation() {
  const detail = Route.useLoaderData();
  const router = useRouter();
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function onReply(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(undefined);
    try {
      const { emailed } = await replyAsStaff({ data: { id: detail.id, content: reply } });
      setReply('');
      setNotice(
        emailed
          ? '返信しました。チャットに表示され、メールでも通知しました。'
          : '返信しました。チャットに表示されます（メールは送信されていません）。',
      );
      await router.invalidate();
    } catch {
      setNotice('返信できませんでした。もう一度お試しください。');
    }
    setPending(false);
  }

  async function toggleStatus() {
    const status = detail.status === 'open' ? 'closed' : 'open';
    await setAdminConversationStatus({ data: { id: detail.id, status } });
    await router.invalidate();
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1.5')}>
          <ArrowLeft className="size-4" />
          受信箱
        </Link>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            detail.status === 'open'
              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
              : 'bg-fd-muted text-fd-muted-foreground',
          )}
        >
          {detail.status === 'open' ? '対応中' : '完了'}
        </span>
        <button
          type="button"
          onClick={() => void toggleStatus()}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ms-auto')}
        >
          {detail.status === 'open' ? '完了にする' : '対応中に戻す'}
        </button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fd-muted-foreground">返信先</dt>
        <dd className="wrap-anywhere">{detail.email ?? 'メールアドレスなし'}</dd>
        <dt className="text-fd-muted-foreground">言語</dt>
        <dd>{detail.lang}</dd>
        {detail.pagePath && (
          <>
            <dt className="text-fd-muted-foreground">ページ</dt>
            <dd className="wrap-anywhere">
              <a href={`${siteUrl}${detail.pagePath}`} target="_blank" rel="noreferrer" className="underline">
                {detail.pagePath}
              </a>
            </dd>
          </>
        )}
        <dt className="text-fd-muted-foreground">開始</dt>
        <dd>{formatDateTime(detail.createdAt)}</dd>
      </dl>

      <ol className="flex flex-col gap-3">
        {detail.messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </ol>

      <form onSubmit={onReply} className="flex flex-col gap-2 rounded-xl border p-4">
        <label htmlFor="staff-reply" className="text-sm font-medium">
          返信
        </label>
        <textarea
          id="staff-reply"
          required
          rows={6}
          maxLength={supportLimits.messageLength}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          className="resize-y rounded-lg border bg-fd-card px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-fd-ring sm:text-sm"
        />
        <p className="text-xs text-fd-muted-foreground">
          ユーザーのチャットに表示され（Markdown 可）、返信先があればメールでも届きます。返信すると完了になり、ユーザーが再度送信すると対応中に戻ります。
        </p>
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || !reply.trim()}
          className={cn(buttonVariants({ variant: 'primary' }), 'gap-2 self-start disabled:opacity-50')}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          返信を送信
        </button>
      </form>
    </AdminShell>
  );
}
