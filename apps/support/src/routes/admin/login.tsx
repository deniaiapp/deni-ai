import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AdminShell, adminHead } from '@/components/admin/admin-shell';
import { adminSignIn, getAdminStatus } from '@/lib/admin-api';
import { cn } from '@/lib/cn';

export const Route = createFileRoute('/admin/login')({
  beforeLoad: async () => {
    const status = await getAdminStatus();
    if (status.signedIn) throw redirect({ to: '/admin' });
    return { enabled: status.enabled };
  },
  loader: ({ context }) => ({ enabled: context.enabled }),
  head: () => adminHead('ログイン'),
  component: AdminLogin,
});

const errors = {
  wrong: 'パスワードが違います。',
  rate_limited: '試行回数が多すぎます。しばらく待ってからお試しください。',
  failed: 'ログインできませんでした。',
} as const;

function AdminLogin() {
  const { enabled } = Route.useLoaderData();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<keyof typeof errors>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await adminSignIn({ data: { password } });
      if (result.ok) {
        await router.navigate({ to: '/admin' });
        return;
      }
      setError(result.error);
    } catch {
      setError('failed');
    }
    setPending(false);
  }

  return (
    <AdminShell signedIn={false}>
      {enabled ? (
        <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
          <label htmlFor="admin-password" className="text-sm font-medium">
            管理者パスワード
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border bg-fd-card px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-fd-ring sm:text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errors[error]}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !password}
            className={cn(
              buttonVariants({ variant: 'primary' }),
              'gap-2 self-start disabled:opacity-50',
            )}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            ログイン
          </button>
        </form>
      ) : (
        <p className="text-sm text-fd-muted-foreground">
          受信箱は設定されていません。DATABASE_URL、SUPPORT_SECRET、SUPPORT_ADMIN_TOKEN
          を設定してください。
        </p>
      )}
    </AdminShell>
  );
}
