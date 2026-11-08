import { useMutation } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useExtracted, useFormatter } from "use-intl";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import { runFetch, useInvalidateRun, useRunNotifications, useRunState } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { RunLoading, RunPage } from "./run-page";
import { Link } from "@/lib/navigation";

/** `/run/notifications`: completed, failed, approval and takeover notices. */
export function RunNotificationsPage() {
  const t = useExtracted();
  const format = useFormatter();
  const notifications = useRunNotifications();
  const state = useRunState();
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const mark = useMutation({
    mutationFn: (body: { id?: string; all?: boolean }) =>
      runFetch("notifications", { method: "PATCH", body }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });
  if (notifications.isLoading) return <RunLoading />;
  const items = notifications.data?.notifications ?? [];
  const kinds: Record<string, string> = {
    completed: t("Completed"),
    failed: t("Failed"),
    approval: t("Approval"),
    takeover: t("Takeover"),
    info: t("Info"),
  };
  const threadOfJob = (jobId: string | null) =>
    jobId ? state.data?.jobs.find((job) => job.id === jobId)?.threadId : undefined;
  return (
    <RunPage
      title={t("Notifications")}
      actions={
        items.some((item) => !item.readAt) ? (
          <Button variant="outline" onClick={() => mark.mutate({ all: true })}>
            <CheckCheck className="size-4" />
            {t("Mark all read")}
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No notifications.")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => {
            const threadId = threadOfJob(item.jobId);
            return (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.kind === "failed" ? "destructive" : "secondary"}>
                      {kinds[item.kind] ?? item.kind}
                    </Badge>
                    <span className={item.readAt ? "text-sm" : "text-sm font-semibold"}>
                      {item.title}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-sm text-muted-foreground">{item.body}</p>
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(item.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {threadId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      render={<Link href={`/run/threads/${threadId}`} />}
                      nativeButton={false}
                      onClick={() => {
                        if (!item.readAt) mark.mutate({ id: item.id });
                      }}
                    >
                      {t("Open")}
                    </Button>
                  ) : null}
                  {!item.readAt ? (
                    <Button size="sm" variant="ghost" onClick={() => mark.mutate({ id: item.id })}>
                      {t("Mark read")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </RunPage>
  );
}
