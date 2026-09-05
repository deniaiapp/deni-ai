"use client";

import {
  ClockIcon,
  LightningIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import {
  Copy,
  Eye,
  EyeOff,
  FolderInput,
  FolderMinus,
  MessageSquare,
  Pencil,
  Pin,
  Trash2,
  Loader2,
  Plug,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { easeOut } from "@/lib/motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SidebarClose,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { Bot, Routine, Skill, Thread } from "@/lib/types";
import type { UsageSnapshot } from "@/lib/plans";
import { AccountMenu } from "./account-menu";

const DEFAULT_BOT_IDS = new Set(["chief", "research", "ops"]);

export type TeammateMenuAction =
  | "pin"
  | "new-section"
  | "remove-section"
  | "unread"
  | "edit"
  | "duplicate"
  | "hide"
  | "delete";

export function Sidebar({
  bots,
  threads,
  skills,
  routines,
  activeThreadId,
  onSelectThread,
  onNewBot,
  onNewGroup,
  onOpenSkills,
  onOpenRoutines,
  onOpenMcp,
  onTeammateAction,
  usage,
  onOpenBilling,
  loadingThreadId = null,
  actionBusyId = null,
  jobStateByThread,
  notifications,
}: {
  bots: Bot[];
  threads: Thread[];
  skills: Skill[];
  routines: Routine[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewBot: () => void;
  onNewGroup: () => void;
  onOpenSkills: () => void;
  onOpenRoutines: () => void;
  onOpenMcp: () => void;
  onTeammateAction: (thread: Thread, bot: Bot, action: TeammateMenuAction) => void;
  usage: UsageSnapshot | null;
  onOpenBilling: () => void;
  loadingThreadId?: string | null;
  actionBusyId?: string | null;
  jobStateByThread?: Record<string, "running" | "waiting" | "attention">;
  notifications?: ReactNode;
}) {
  const dms = threads.filter((item) => item.kind === "dm");
  const groups = threads.filter((item) => item.kind === "group");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (value: string) =>
    !normalizedQuery || value.toLowerCase().includes(normalizedQuery);
  const visibleDms = dms.filter((thread) => {
    const bot = bots.find((item) => item.id === thread.botIds[0]);
    return Boolean(
      bot && matches(`${bot.name} ${thread.lastPreview || bot.job} ${thread.section ?? ""}`),
    );
  });
  const visibleGroups = groups.filter((thread) => matches(`${thread.title} ${thread.lastPreview}`));
  const hiddenDms = visibleDms.filter((thread) => thread.hidden);
  const shownDms = visibleDms.filter((thread) => !thread.hidden);
  const sectionNames: string[] = [];
  for (const thread of shownDms) {
    if (thread.section && !sectionNames.includes(thread.section)) {
      sectionNames.push(thread.section);
    }
  }
  const unsectioned = shownDms.filter((thread) => !thread.section);
  const showTeammatesGroup = unsectioned.length > 0 || sectionNames.length === 0;

  return (
    <>
      <SidebarHeader className="h-[54px] shrink-0 gap-2 bg-[#111111]">
        <div className="min-w-0 flex-1 whitespace-normal">
          <h1 className="text-sm font-semibold text-[#bdbdbd]">Deni Run</h1>
        </div>
        <button type="button" onClick={onNewBot} aria-label="New teammate" title="New teammate" className="flex size-8 items-center justify-center rounded-lg text-[#999999] hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white/50">
          <PlusIcon size={18} />
        </button>
        <SidebarClose className="md:hidden" />
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 pb-1">
          <label className="flex items-center gap-2 rounded-lg bg-[#242424] px-2.5 py-1.5 text-sm text-[#a5a5a5] ring-1 ring-white/5 focus-within:ring-white/20">
            <MagnifyingGlassIcon size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search"
              aria-label="Search conversations"
              className="min-w-0 flex-1 bg-transparent text-[#f0f0f0] outline-none placeholder:text-[#8a8a8a]"
            />
          </label>
        </div>
        {showTeammatesGroup ? (
          <TeammateGroup
            label="Teammates"
            threads={unsectioned}
            bots={bots}
            activeThreadId={activeThreadId}
            loadingThreadId={loadingThreadId}
            actionBusyId={actionBusyId}
            jobStateByThread={jobStateByThread}
            onSelectThread={onSelectThread}
            onTeammateAction={onTeammateAction}
          />
        ) : null}
        {sectionNames.map((name) => (
          <TeammateGroup
            key={name}
            label={name}
            labelClassName="normal-case tracking-normal"
            threads={shownDms.filter((thread) => thread.section === name)}
            bots={bots}
            activeThreadId={activeThreadId}
            loadingThreadId={loadingThreadId}
            actionBusyId={actionBusyId}
            jobStateByThread={jobStateByThread}
            onSelectThread={onSelectThread}
            onTeammateAction={onTeammateAction}
          />
        ))}
        {hiddenDms.length > 0 ? (
          <TeammateGroup
            label="Hidden"
            threads={hiddenDms}
            bots={bots}
            activeThreadId={activeThreadId}
            loadingThreadId={loadingThreadId}
            actionBusyId={actionBusyId}
            jobStateByThread={jobStateByThread}
            onSelectThread={onSelectThread}
            onTeammateAction={onTeammateAction}
          />
        ) : null}

        {groups.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Groups</SidebarGroupLabel>
            <div className="flex flex-col gap-0.5">
              {visibleGroups.map((thread) => {
                const active = activeThreadId === thread.id;
                return (
                  <motion.button
                    key={thread.id}
                    type="button"
                    onClick={() => onSelectThread(thread.id)}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.28, ease: easeOut }}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left whitespace-normal",
                      active ? "bg-[#2d2d2d]" : "hover:bg-white/5",
                    )}
                  >
                    <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs text-[#8f8f8f]">
                      {thread.botIds.length}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="min-w-0 truncate text-[0.925rem] text-[#f0f0f0]">
                        {thread.title}
                      </span>
                      <span className="min-w-0 truncate text-xs text-[#8f8f8f]">
                        {thread.lastPreview}
                      </span>
                    </span>
                    {jobStateByThread?.[thread.id] === "running" ? (
                      <Loader2 className="mt-1.5 size-3.5 shrink-0 animate-spin text-[#8f8f8f]" aria-label="Task running" />
                    ) : jobStateByThread?.[thread.id] === "waiting" ? (
                      <span className="mt-1.5 text-xs text-amber-300" aria-label="Task waiting">⏸</span>
                    ) : jobStateByThread?.[thread.id] === "attention" ? (
                      <span className="mt-1.5 text-xs text-amber-300" aria-label="Task needs attention">⚠</span>
                    ) : null}
                  </motion.button>
                );
              })}
            </div>
          </SidebarGroup>
        ) : null}

        <SidebarGroup className="mt-auto pt-6">
          <SidebarMenu>
            <SidebarMenuButton icon={PlusIcon} onClick={onNewBot}>
              New teammate
            </SidebarMenuButton>
            <SidebarMenuButton icon={UsersThreeIcon} onClick={onNewGroup}>
              New group
            </SidebarMenuButton>
            <SidebarMenuButton icon={LightningIcon} onClick={onOpenSkills}>
              Skills
              <SidebarMenuBadge>{skills.length}</SidebarMenuBadge>
            </SidebarMenuButton>
            <SidebarMenuButton icon={ClockIcon} onClick={onOpenRoutines}>
              Routines
              <SidebarMenuBadge>{routines.length}</SidebarMenuBadge>
            </SidebarMenuButton>
            <SidebarMenuButton icon={Plug} onClick={onOpenMcp}>
              Plugins
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-2 pt-1">
        <div className="flex w-full items-center justify-between gap-2">
          <AccountMenu usage={usage} onOpenBilling={onOpenBilling} />
          <div className="ml-auto flex items-center gap-1">{notifications}
          <SidebarTrigger className="hidden md:inline-flex" />
          </div>
        </div>
      </SidebarFooter>
    </>
  );
}

function TeammateGroup({
  label,
  labelClassName,
  threads,
  bots,
  activeThreadId,
  loadingThreadId,
  actionBusyId,
  jobStateByThread,
  onSelectThread,
  onTeammateAction,
}: {
  label: string;
  labelClassName?: string;
  threads: Thread[];
  bots: Bot[];
  activeThreadId: string | null;
  loadingThreadId?: string | null;
  actionBusyId?: string | null;
  jobStateByThread?: Record<string, "running" | "waiting" | "attention">;
  onSelectThread: (id: string) => void;
  onTeammateAction: (thread: Thread, bot: Bot, action: TeammateMenuAction) => void;
}) {
  const sorted = [...threads].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return (
    <SidebarGroup>
      {label !== "Teammates" ? <SidebarGroupLabel className={labelClassName}>{label}</SidebarGroupLabel> : null}
      <div className="flex flex-col gap-0.5">
        {sorted.map((thread) => {
          const bot = bots.find((item) => item.id === thread.botIds[0]);
          if (!bot) return null;
          return (
            <TeammateRow
              key={thread.id}
              thread={thread}
              bot={bot}
              active={activeThreadId === thread.id}
              loading={loadingThreadId === thread.id || actionBusyId === bot.id || jobStateByThread?.[thread.id] === "running"}
              jobState={jobStateByThread?.[thread.id]}
              onSelect={() => onSelectThread(thread.id)}
              onAction={(action) => onTeammateAction(thread, bot, action)}
            />
          );
        })}
      </div>
    </SidebarGroup>
  );
}

function TeammateRow({
  thread,
  bot,
  active,
  loading,
  jobState,
  onSelect,
  onAction,
}: {
  thread: Thread;
  bot: Bot;
  active: boolean;
  loading?: boolean;
  jobState?: "running" | "waiting" | "attention";
  onSelect: () => void;
  onAction: (action: TeammateMenuAction) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: easeOut }}
    >
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-2 py-2.5 text-left whitespace-normal",
            active ? "bg-[#2d2d2d]" : "hover:bg-white/5",
          )}
        >
          <Avatar name={bot.name} accent={bot.accent} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-[#f0f0f0]">{bot.name}</span>
              <time dateTime={thread.updatedAt} className="shrink-0 text-[10px] text-[#8f8f8f]">{thread.updatedAt.slice(5, 10).replace("-", "/")}</time>
            </span>
            <span className="min-w-0 truncate text-xs text-[#8f8f8f]">
              {thread.lastPreview || bot.job}
            </span>
          </span>
          {loading ? (
            <Loader2 className="mt-1.5 size-3.5 shrink-0 animate-spin text-[#8f8f8f]" />
          ) : jobState === "waiting" ? (
            <span className="mt-1.5 text-xs text-amber-300" aria-label="Task waiting">⏸</span>
          ) : jobState === "attention" ? (
            <span className="mt-1.5 text-xs text-amber-300" aria-label="Task needs attention">⚠</span>
          ) : thread.pinned ? (
            <Pin className="mt-1.5 size-3 shrink-0 text-[#8f8f8f]" aria-label="Pinned" />
          ) : null}
          {thread.unread ? (
            <span className="mt-2 size-2 shrink-0 rounded-full bg-[#6ea8fe]" aria-label="Unread" />
          ) : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onAction("pin")}>
          <Pin />
          {thread.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction("new-section")}>
          <FolderInput />
          Move to new section
        </ContextMenuItem>
        {thread.section ? (
          <ContextMenuItem onSelect={() => onAction("remove-section")}>
            <FolderMinus />
            Remove from section
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onAction("unread")}>
          <MessageSquare />
          {thread.unread ? "Mark as Read" : "Mark as Unread"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction("edit")}>
          <Pencil />
          Edit Profile
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction("duplicate")}>
          <Copy />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onAction("hide")}>
          {thread.hidden ? <Eye /> : <EyeOff />}
          {thread.hidden ? "Show in sidebar" : "Hide from sidebar"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={DEFAULT_BOT_IDS.has(bot.id)}
          onSelect={() => onAction("delete")}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    </motion.div>
  );
}

export function Avatar({ name, accent }: { name: string; accent: string }) {
  return (
    <span
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs text-white"
      style={{ background: accent }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
