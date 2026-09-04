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
} from "lucide-react";
import { useState } from "react";
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
  onTeammateAction,
  usage,
  onOpenBilling,
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
  onTeammateAction: (thread: Thread, bot: Bot, action: TeammateMenuAction) => void;
  usage: UsageSnapshot | null;
  onOpenBilling: () => void;
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
      <SidebarHeader className="gap-3 border-b border-white/10 bg-[#111111]">
        <div className="min-w-0 flex-1 whitespace-normal">
          <h1 className="text-[0.925rem] font-semibold text-[#f0f0f0]">Deni Run</h1>
        </div>
        <SidebarClose className="md:hidden" />
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 pt-3 pb-2">
          <label className="flex items-center gap-2 rounded-lg bg-[#242424] px-3 py-2 text-sm text-[#a5a5a5] ring-1 ring-white/5 focus-within:ring-white/20">
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
                  </motion.button>
                );
              })}
            </div>
          </SidebarGroup>
        ) : null}

        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuButton icon={PlusIcon} onClick={onNewBot}>
              Teammates
            </SidebarMenuButton>
            <SidebarMenuButton icon={UsersThreeIcon} onClick={onNewGroup}>
              Groups
            </SidebarMenuButton>
            <SidebarMenuButton icon={LightningIcon} onClick={onOpenSkills}>
              Skills
              <SidebarMenuBadge>{skills.length}</SidebarMenuBadge>
            </SidebarMenuButton>
            <SidebarMenuButton icon={ClockIcon} onClick={onOpenRoutines}>
              Routines
              <SidebarMenuBadge>{routines.length}</SidebarMenuBadge>
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-2 border-t border-white/10">
        <div className="flex items-center justify-between gap-2">
          <AccountMenu usage={usage} onOpenBilling={onOpenBilling} />
          <SidebarTrigger className="hidden md:inline-flex" />
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
  onSelectThread,
  onTeammateAction,
}: {
  label: string;
  labelClassName?: string;
  threads: Thread[];
  bots: Bot[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onTeammateAction: (thread: Thread, bot: Bot, action: TeammateMenuAction) => void;
}) {
  const sorted = [...threads].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return (
    <SidebarGroup>
      <SidebarGroupLabel className={labelClassName}>{label}</SidebarGroupLabel>
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
  onSelect,
  onAction,
}: {
  thread: Thread;
  bot: Bot;
  active: boolean;
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
            "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left whitespace-normal",
            active ? "bg-[#2d2d2d]" : "hover:bg-white/5",
          )}
        >
          <Avatar name={bot.name} accent={bot.accent} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="min-w-0 truncate text-[0.925rem] text-[#f0f0f0]">{bot.name}</span>
            <span className="min-w-0 truncate text-xs text-[#8f8f8f]">
              {thread.lastPreview || bot.job}
            </span>
          </span>
          {thread.pinned ? (
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
