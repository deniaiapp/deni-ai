import { useState } from "react";
import { Bot as BotIcon, ChevronDownIcon, Plus, Users } from "lucide-react";
import { useExtracted } from "use-intl";
import { Alert, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Button } from "@deniai/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@deniai/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@deniai/ui/components/empty";
import { DocumentTitle } from "@/components/document-title";
import { Link, useRouter } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useRunState, useRunStatus, type Bot } from "./run-api";
import { RunComposer, useRunMode, type RunComposerMessage } from "./run-composer";
import { RunLoading, setPendingTask } from "./run-page";
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
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>{t("Deni Run is not configured on this server")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Hand work to AI teammates that finish it on their own computer. Ask an administrator to configure Run on this server.",
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/chat" />} nativeButton={false}>
              {t("Back to Chat")}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </>
  );
}

/** Who gets the task, in the place of the chat model picker. */
function TeammatePicker({
  bots,
  selected,
  onSelect,
}: {
  bots: Bot[];
  selected: Bot | undefined;
  onSelect: (id: string) => void;
}) {
  const t = useExtracted();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("Teammate")}
            className={cn(
              "h-auto gap-1.5 border-none bg-transparent px-2 py-1.5 font-medium text-muted-foreground shadow-none transition-colors",
              "hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground",
            )}
          />
        }
      >
        {selected ? (
          <TeammateAvatar
            name={selected.name}
            icon={selected.icon}
            accent={selected.accent}
            size="sm"
            className="size-4 text-[10px] ring-1"
          />
        ) : null}
        <span className="max-w-30 truncate text-sm">{selected?.name ?? t("Teammate")}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        {bots.map((bot) => (
          <DropdownMenuItem
            key={bot.id}
            onClick={() => onSelect(bot.id)}
            className={cn("gap-2 p-2", bot.id === selected?.id && "bg-accent")}
          >
            <TeammateAvatar name={bot.name} icon={bot.icon} accent={bot.accent} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{bot.name}</span>
              <span className="truncate text-xs text-muted-foreground">{bot.job}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem render={<Link href="/run/teammates/new" />} className="gap-2 p-2">
          <Plus className="size-4" />
          {t("Add teammate")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConversationRow({
  href,
  name,
  icon,
  accent,
  preview,
  unread,
}: {
  href: string;
  name: string;
  icon?: string | null;
  accent?: string | null;
  preview?: string;
  unread?: boolean;
}) {
  const t = useExtracted();
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent">
        <TeammateAvatar name={name} icon={icon} accent={accent} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
              {name}
            </span>
            {unread ? (
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-label={t("Unread")} />
            ) : null}
          </span>
          {preview ? (
            <span className="block truncate text-xs text-muted-foreground">{preview}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** Run mode home: hand a task to a teammate from the same message box as a conversation. */
export function RunHome() {
  const t = useExtracted();
  const status = useRunStatus();
  const configured = status.data?.configured === true;
  const state = useRunState({ enabled: configured });
  const [runMode, setRunMode] = useRunMode(state.data);
  const { push } = useRouter();
  const [task, setTask] = useState("");
  const [teammateId, setTeammateId] = useState<string | null>(null);

  if (status.isLoading) return <RunLoading />;
  if (!configured) return <RunUnavailable />;
  if (state.isLoading || !state.data) return <RunLoading />;

  const data = state.data;
  const selected = data.bots.find((bot) => bot.id === teammateId) ?? data.bots[0];
  const dmFor = (botId: string) =>
    data.threads.find((thread) => thread.kind === "dm" && thread.botIds[0] === botId);
  const groups = data.threads
    .filter((thread) => thread.kind === "group" && !thread.hidden)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const start = (message: RunComposerMessage) => {
    const dm = selected ? dmFor(selected.id) : undefined;
    if (!dm) return;
    setPendingTask(dm.id, message);
    setTask("");
    push(`/run/threads/${dm.id}`);
  };

  return (
    <>
      <DocumentTitle title={t("Run")} />
      <section className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-4 [justify-content:safe_center] md:px-6">
        <div className="flex w-full max-w-[46rem] flex-col gap-6 py-6 md:gap-8">
          <h1 className="animate-fade-in-up text-center text-2xl leading-[1.1] font-semibold tracking-[-0.035em] text-balance md:text-3xl">
            {t("What should your teammates do?")}
          </h1>

          {data.capabilities && !data.capabilities.llm && !data.ready ? (
            <Alert>
              <AlertTitle>{t("No AI model is configured")}</AlertTitle>
              <AlertDescription>
                {t(
                  "Teammates cannot answer until a language model is configured for Run on this server.",
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <RunComposer
            value={task}
            onValueChange={setTask}
            onSubmit={start}
            disabled={!selected}
            placeholder={t("Message {name}", { name: selected?.name ?? "" })}
            runMode={runMode}
            onRunModeChange={setRunMode}
            extraTools={
              <TeammatePicker bots={data.bots} selected={selected} onSelect={setTeammateId} />
            }
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("Teammates")}</h2>
              <span
                className="text-xs tabular-nums text-muted-foreground"
                title={t("Teammates on your plan")}
              >
                {t("{used} / {limit}", {
                  used: String(data.bots.length),
                  limit: String(data.teammateLimit.limit),
                })}
              </span>
            </div>
            <ul className="flex flex-col">
              {data.bots.map((bot) => {
                const dm = dmFor(bot.id);
                return (
                  <ConversationRow
                    key={bot.id}
                    href={dm ? `/run/threads/${dm.id}` : `/run/teammates/${bot.id}`}
                    name={bot.name}
                    icon={bot.icon}
                    accent={bot.accent}
                    preview={dm?.lastPreview || bot.job}
                    unread={dm?.unread}
                  />
                );
              })}
              {groups.map((group) => (
                <ConversationRow
                  key={group.id}
                  href={`/run/threads/${group.id}`}
                  name={group.title}
                  icon={group.icon || "👥"}
                  preview={group.lastPreview}
                  unread={group.unread}
                />
              ))}
            </ul>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                render={<Link href="/run/teammates/new" />}
                nativeButton={false}
              >
                <Plus className="size-4" />
                {t("Add teammate")}
              </Button>
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
          </div>
        </div>
      </section>
    </>
  );
}
