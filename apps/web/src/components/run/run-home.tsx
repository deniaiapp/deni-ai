import { useState } from "react";
import { Bot, ExternalLink, Plus, Send, Users } from "lucide-react";
import { useExtracted } from "use-intl";
import { Alert, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@deniai/ui/components/empty";
import { Textarea } from "@deniai/ui/components/textarea";
import { DocumentTitle } from "@/components/document-title";
import { Link, useRouter } from "@/lib/navigation";
import { clientEnv } from "@/public-env";
import { useRunState, useRunStatus } from "./run-api";
import { RunLoading, RunPage, setPendingTask } from "./run-page";
import { TeammateAvatar } from "./teammate-avatar";

/** Shown only while Run is not set up on this server. */
function RunUnavailable() {
  const t = useExtracted();
  return (
    <>
      <DocumentTitle title={t("Run")} />
      <div className="flex flex-1 items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>{t("Deni Run is coming to this app")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Hand work to AI teammates that finish it on their own computer. Until Run is ready here, keep using the standalone app.",
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              render={
                <a href={clientEnv.NEXT_PUBLIC_DENI_RUN_URL} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
            >
              {t("Open Deni Run")}
              <ExternalLink className="size-4" />
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </>
  );
}

/** Run mode home: hand a task to a teammate, see the team and recent conversations. */
export function RunHome() {
  const t = useExtracted();
  const status = useRunStatus();
  const configured = status.data?.configured === true;
  const state = useRunState({ enabled: configured });
  const { push } = useRouter();
  const [task, setTask] = useState("");
  const [teammateId, setTeammateId] = useState<string | null>(null);

  if (status.isLoading) return <RunLoading />;
  if (!configured) return <RunUnavailable />;
  if (state.isLoading || !state.data) return <RunLoading />;

  const data = state.data;
  const selected = data.bots.find((bot) => bot.id === teammateId) ?? data.bots[0];
  const recent = data.threads
    .filter((thread) => !thread.hidden)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const start = () => {
    const text = task.trim();
    if (!text || !selected) return;
    const dm = data.threads.find(
      (thread) => thread.kind === "dm" && thread.botIds[0] === selected.id,
    );
    if (!dm) return;
    setPendingTask(dm.id, text);
    push(`/run/threads/${dm.id}`);
  };

  return (
    <RunPage
      title={t("Run")}
      description={t("Hand work to AI teammates. They finish it on their own computer.")}
      actions={
        <Button variant="outline" render={<Link href="/run/teammates/new" />} nativeButton={false}>
          <Plus className="size-4" />
          {t("Add teammate")}
        </Button>
      }
    >
      {data.capabilities && !data.capabilities.llm && !data.ready ? (
        <Alert>
          <AlertTitle>{t("No AI model is configured")}</AlertTitle>
          <AlertDescription>
            {t(
              "Teammates cannot answer until an OpenRouter key is configured for Run on this server.",
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("New task")}</CardTitle>
          <CardDescription>{t("Choose a teammate and describe the work.")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Teammate")}>
            {data.bots.map((bot) => (
              <Button
                key={bot.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === bot.id}
                variant={selected?.id === bot.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTeammateId(bot.id)}
              >
                <TeammateAvatar name={bot.name} icon={bot.icon} accent={bot.accent} size="sm" />
                {bot.name}
              </Button>
            ))}
          </div>
          <Textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder={t("Research the three best note-taking apps and write a comparison.")}
            rows={3}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) start();
            }}
          />
          <div className="flex justify-end">
            <Button onClick={start} disabled={!task.trim() || !selected}>
              <Send className="size-4" />
              {t("Send to {name}", { name: selected?.name ?? "" })}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("Teammates")}</h2>
          <span className="text-sm text-muted-foreground">
            {t("{used} of {limit} on your plan", {
              used: String(data.bots.length),
              limit: String(data.teammateLimit.limit),
            })}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.bots.map((bot) => (
            <Card key={bot.id} size="sm">
              <CardHeader className="flex flex-row items-center gap-3">
                <TeammateAvatar name={bot.name} icon={bot.icon} accent={bot.accent} />
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate">{bot.name}</CardTitle>
                  <CardDescription className="truncate">{bot.job}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  render={<Link href={`/run/threads/dm_${bot.id}`} />}
                  nativeButton={false}
                >
                  {t("Message")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  render={<Link href={`/run/teammates/${bot.id}`} />}
                  nativeButton={false}
                >
                  {t("Edit")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("Recent conversations")}</h2>
          <Button
            size="sm"
            variant="ghost"
            render={<Link href="/run/groups/new" />}
            nativeButton={false}
          >
            <Users className="size-4" />
            {t("New group")}
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No conversations yet.")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recent.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/run/threads/${thread.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className={thread.unread ? "font-semibold" : "font-medium"}>
                      {thread.title}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{thread.lastPreview}</p>
                  </div>
                  {thread.kind === "group" ? (
                    <Users className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RunPage>
  );
}
