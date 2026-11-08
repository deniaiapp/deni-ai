import type { ReactNode } from "react";
import { Spinner } from "@deniai/ui/components/spinner";
import { DocumentTitle } from "@/components/document-title";

/** The frame of a Run mode page: title, optional description and actions, content. */
export function RunPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <DocumentTitle title={title} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 py-2">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
        {children}
      </div>
    </>
  );
}

export function RunLoading() {
  return (
    <div className="flex min-h-[40vh] flex-1 items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

/** Hand a first message from the home composer to the thread view (not via the URL). */
const PENDING_KEY = "deni-run:pending-task";

export function setPendingTask(threadId: string, text: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ threadId, text }));
  } catch {
    // Storage unavailable: the user types the task again.
  }
}

export function takePendingTask(threadId: string): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { threadId?: string; text?: string };
    if (value.threadId !== threadId || !value.text) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return value.text;
  } catch {
    return null;
  }
}
