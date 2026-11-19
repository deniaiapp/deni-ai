import { Link, useRouter } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { Inbox, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { adminSignOut } from '@/lib/admin-api';
import { cn } from '@/lib/cn';
import { appName } from '@/lib/shared';

/** Frame of the admin inbox pages (internal, Japanese only). */
export function AdminShell({ children, signedIn = true }: { children: ReactNode; signedIn?: boolean }) {
  const router = useRouter();

  async function signOut() {
    await adminSignOut();
    await router.navigate({ to: '/admin/login' });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3 border-b pb-4">
        <Link to="/admin" className="inline-flex items-center gap-2 font-semibold">
          <Inbox className="size-5" />
          {appName} 受信箱
        </Link>
        {signedIn && (
          <button
            type="button"
            onClick={() => void signOut()}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'ms-auto gap-1.5')}
          >
            <LogOut className="size-4" />
            ログアウト
          </button>
        )}
      </header>
      {children}
    </div>
  );
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const adminHead = (title: string) => ({
  meta: [{ title: `${title} | ${appName}` }, { name: 'robots', content: 'noindex, nofollow' }],
});
