"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { easeOut } from "@/lib/motion";
import { RobotIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  BookOpenIcon,
  BrainIcon,
  ClockIcon,
  FolderIcon,
  GlobeIcon,
  SendIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Avatar } from "./sidebar";
import { RUN_MODES, type RunMode } from "@/lib/model";
import type { Bot, HandoffSnapshot, Thread } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ChatThread({
  thread,
  bot,
  bots,
  initialMessages,
  runMode,
  onRunModeChange,
  onBusyChange,
}: {
  thread: Thread;
  bot: Bot;
  bots: Bot[];
  initialMessages: UIMessage[];
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ threadId: thread.id, botId: bot.id, runMode }),
        prepareSendMessagesRequest: ({ messages: pending, body, trigger }) => ({
          body: {
            ...body,
            trigger,
            messages: trigger === "submit-message" ? pending.slice(-2) : [],
          },
        }),
      }),
    [thread.id, bot.id, runMode],
  );

  const { messages, sendMessage, status, addToolApprovalResponse, stop, error, clearError } =
    useChat({
      id: thread.id,
      messages: initialMessages,
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  const onApprove = useCallback(
    (id: string, approved: boolean) => {
      addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse],
  );

  const [input, setInput] = useState("");
  const [handoffs, setHandoffs] = useState<Record<string, HandoffSnapshot>>({});
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const ids = collectHandoffIds(messages);
    if (ids.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      const res = await fetch("/api/handoffs");
      const json = (await res.json()) as { handoffs?: HandoffSnapshot[] };
      if (cancelled) return;
      const byId = new Map((json.handoffs ?? []).map((item) => [item.id, item]));
      const next: Record<string, HandoffSnapshot> = {};
      for (const id of ids) {
        const item = byId.get(id);
        if (item) next[id] = item;
      }
      setHandoffs(next);
      if (timer && Object.values(next).every((item) => item.status !== "running")) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    void tick();
    timer = setInterval(() => void tick(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [messages]);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendMessage({ text });
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#050505] text-[#f0f0f0]">
      <motion.header
        className="hidden items-center gap-3 border-b border-white/10 bg-[#050505] px-5 py-3 md:flex"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: easeOut }}
      >
        <Avatar name={bot.name} accent={bot.accent} />
        <div className="min-w-0 flex-1 flex gap-1 items-center">
          <span className="min-w-0 truncate text-[0.925rem] font-semibold text-[#f0f0f0]">
            {thread.kind === "group" ? thread.title : bot.name}
          </span>
          <span className="min-w-0 truncate text-xs tracking-tighter text-[#8f8f8f]">
            {thread.kind === "group"
              ? bots
                  .filter((item) => thread.botIds.includes(item.id))
                  .map((item) => item.name)
                  .join(" · ")
              : bot.job}
          </span>
        </div>
        {busy ? (
          <Button
            type="button"
            variant="secondary-destructive"
            size="xs"
            icon={StopIcon}
            onClick={() => stop()}
          >
            Stop
          </Button>
        ) : (
          <span className="text-xs tracking-tighter text-[#8f8f8f]">{RUN_MODES[runMode].hint}</span>
        )}
      </motion.header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <EmptyState bot={bot} />
            </ConversationEmptyState>
          ) : (
            messages.map((message, index) => (
              <MessageBlock
                key={message.id || `message-${index}`}
                workKey={`${thread.id}:${index}`}
                message={message}
                isLastMessage={index === messages.length - 1}
                isStreaming={busy}
                onApprove={onApprove}
                handoffs={handoffs}
                bots={bots}
              />
            ))
          )}
          {busy ? (
            <span className="text-xs text-[#8f8f8f]">
              Working on the computer
              <AnimatedDots />
            </span>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <WarningCircleIcon weight="fill" />
              <AlertTitle>Failed to send</AlertTitle>
              <AlertDescription>
                <p>{error.message}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => clearError()}
                  className="-ml-2"
                >
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-white/10 bg-[#050505] px-4 py-3 md:px-8 md:pb-8 xl:pb-3">
        <PromptInput
          className="mx-auto w-full max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onSubmit={submit}
            placeholder={`Hand work to ${bot.name}`}
            aria-label={`Hand work to ${bot.name}`}
          />
          <PromptInputToolbar>
            <div className="flex min-w-0 items-center gap-2">
              <RunModePicker value={runMode} onChange={onRunModeChange} />
              <span className="hidden text-xs text-[#777777] sm:inline">
                Enter to send · Shift+Enter for a new line
              </span>
            </div>
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={status === "ready" && !input.trim()}
            />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </section>
  );
}

const workTimers = new Map<string, { start: number; end?: number }>();

function useWorkedDuration(key: string, active: boolean) {
  const [, bump] = useState(0);

  useEffect(() => {
    let rec = workTimers.get(key);
    if (active) {
      if (!rec) {
        rec = { start: Date.now() };
        workTimers.set(key, rec);
        bump((value) => value + 1);
      }
      return () => {
        const current = workTimers.get(key);
        if (current && current.end == null) {
          current.end = Date.now();
          workTimers.set(key, current);
        }
      };
    }
    if (rec && rec.end == null) {
      rec.end = Date.now();
      workTimers.set(key, rec);
      bump((value) => value + 1);
    }
  }, [key, active]);

  const rec = workTimers.get(key);
  if (!rec?.end) return null;
  return rec.end - rec.start;
}

function formatWorkedDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Worked for ${minutes}m`;
  return `Worked for ${Math.round(minutes / 60)}h`;
}

function collectHandoffIds(messages: UIMessage[]) {
  const ids: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") continue;
      const tool = part as ToolPart;
      const name = tool.toolName ?? part.type.replace(/^tool-/, "");
      if (name !== "messageBot") continue;
      const output =
        tool.output && typeof tool.output === "object"
          ? (tool.output as Record<string, unknown>)
          : null;
      if (typeof output?.handoffId === "string") ids.push(output.handoffId);
    }
  }
  return [...new Set(ids)];
}

function EmptyState({ bot }: { bot: Bot }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeOut }}
    >
      <Empty
        icon={<RobotIcon size={48} className="text-[#6d6d6d]" />}
        title={bot.name}
        description={`${bot.job}. No workflow is required. Write as if you were asking a colleague. I will research on the computer, leave artifacts in files, and ask for approval only when needed.`}
      />
    </motion.div>
  );
}

const MessageBlock = memo(function MessageBlock({
  workKey,
  message,
  isLastMessage,
  isStreaming,
  onApprove,
  handoffs,
  bots,
}: {
  workKey: string;
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
  onApprove: (id: string, approved: boolean) => void;
  handoffs: Record<string, HandoffSnapshot>;
  bots: Bot[];
}) {
  const lastPart = message.parts.at(-1);
  const reasoningIsStreaming = isLastMessage && isStreaming && lastPart?.type === "reasoning";
  const cotSteps = buildCotSteps(message.parts, reasoningIsStreaming, handoffs, bots);
  const cotWorking = cotSteps.length > 0 && isLastMessage && isStreaming;
  const workedMs = useWorkedDuration(workKey, cotWorking);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: easeOut }}
    >
    <Message from={message.role} data-message="">
      {cotSteps.length > 0 ? (
        <ChainOfThought defaultOpen={cotWorking}>
          <ChainOfThoughtHeader>
            {cotWorking ? (
              <>
                Working
                <AnimatedDots />
              </>
            ) : workedMs != null ? (
              formatWorkedDuration(workedMs)
            ) : (
              "Thinking"
            )}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {cotSteps.map((step) => (
              <ChainOfThoughtStep
                key={step.key}
                icon={step.icon}
                label={step.label}
                description={step.description}
                status={step.status}
              >
                {step.hostname ? (
                  <ChainOfThoughtSearchResults>
                    <ChainOfThoughtSearchResult>{step.hostname}</ChainOfThoughtSearchResult>
                  </ChainOfThoughtSearchResults>
                ) : null}
              </ChainOfThoughtStep>
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>
      ) : null}
      <div
        className={
          message.role === "user"
            ? "flex max-w-[min(620px,90%)] flex-col items-end gap-2"
            : "flex min-w-0 w-full max-w-[min(620px,90%)] flex-col gap-2"
        }
      >
        {message.parts.map((part, index) => (
          <PartView
            key={`${message.id}-${index}`}
            part={part}
            onApprove={onApprove}
            isAnimating={isLastMessage && isStreaming}
          />
        ))}
      </div>
    </Message>
    </motion.div>
  );
});

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  error?: unknown;
  rawInput?: unknown;
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean };
};

type CotStep = {
  key: string;
  icon: LucideIcon;
  label: string;
  description?: ReactNode;
  hostname?: string;
  status: "complete" | "active" | "pending";
};

function buildCotSteps(
  parts: UIMessage["parts"],
  reasoningIsStreaming: boolean,
  handoffs?: Record<string, HandoffSnapshot>,
  bots?: Bot[],
): CotStep[] {
  const steps: CotStep[] = [];

  parts.forEach((part, index) => {
    if (part.type === "reasoning") {
      const text = "text" in part ? String(part.text ?? "") : "";
      if (!text) return;
      const { title, body } = splitReasoningTitle(text);
      const isLastPart = index === parts.length - 1;
      steps.push({
        key: `reasoning-${index}`,
        icon: BrainIcon,
        label: title ?? "Reasoning",
        description: body ? <MessageResponse>{body}</MessageResponse> : undefined,
        status: reasoningIsStreaming && isLastPart ? "active" : "complete",
      });
      return;
    }

    if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return;
    const toolPart = part as ToolPart;
    const name = toolPart.toolName ?? part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
    const state = toolPart.state ?? "";
    const input = toolPart.input ?? toolPart.rawInput;
    const errorText =
      toolPart.errorText ?? (toolPart.error != null ? formatDetail(toolPart.error) : "");
    const failed = state === "output-error";

    if (name === "requestTakeover") return;
    if (name === "handoffStatus") return;
    if (toolPart.approval && !toolPart.approval.isAutomatic && state === "approval-requested") {
      return;
    }

    const liveHandoff = name === "messageBot" ? liveHandoffFor(toolPart, handoffs) : undefined;
    steps.push({
      key: toolPart.toolCallId ?? `tool-${index}`,
      icon: toolStepIcon(name),
      label: toolDisplayLabel(name, input, state, liveHandoff, bots),
      description:
        failed && errorText
          ? errorText
          : liveHandoff?.status === "running" && liveHandoff.currentLabel
            ? liveHandoff.currentLabel
            : toolApprovalDetail(name, input),
      hostname:
        !failed && (name === "browser" || name.toLowerCase().includes("browser"))
          ? browserResultHostname(toolPart.output, input)
          : undefined,
      status:
        liveHandoff?.status === "running" || isToolRunning(state) ? "active" : state ? "complete" : "pending",
    });
  });

  return steps;
}

function liveHandoffFor(
  toolPart: ToolPart,
  handoffs?: Record<string, HandoffSnapshot>,
) {
  const output =
    toolPart.output && typeof toolPart.output === "object"
      ? (toolPart.output as Record<string, unknown>)
      : null;
  const id = typeof output?.handoffId === "string" ? output.handoffId : "";
  return id ? handoffs?.[id] : undefined;
}

function splitReasoningTitle(text: string): { title?: string; body?: string } {
  const trimmed = text.trimStart();
  const match = trimmed.match(/^\*\*(.+?)\*\*\s*/);
  if (!match) return { body: text || undefined };
  const rest = trimmed.slice(match[0].length).trim();
  return { title: match[1].trim(), body: rest || undefined };
}

function toolStepIcon(name: string): LucideIcon {
  if (name === "browser" || name.toLowerCase().includes("browser")) return GlobeIcon;
  switch (name) {
    case "workspace":
      return FolderIcon;
    case "runCommand":
    case "stopSandbox":
      return TerminalIcon;
    case "remember":
      return BookOpenIcon;
    case "saveSkill":
    case "listSkills":
    case "readSkill":
      return SparklesIcon;
    case "scheduleRoutine":
    case "listRoutines":
    case "pauseRoutine":
      return ClockIcon;
    case "messageBot":
    case "handoffStatus":
      return SendIcon;
    default:
      return WrenchIcon;
  }
}

function browserResultHostname(output: unknown, input: unknown) {
  const url =
    output &&
    typeof output === "object" &&
    typeof (output as Record<string, unknown>).url === "string"
      ? ((output as Record<string, unknown>).url as string)
      : inputValue(input, "url");
  if (!url) return undefined;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
}

function PartView({
  part,
  onApprove,
  isAnimating = false,
}: {
  part: UIMessage["parts"][number];
  onApprove: (id: string, approved: boolean) => void;
  isAnimating?: boolean;
}) {
  if (part.type === "text" && part.text.trim()) {
    return (
      <MessageContent>
        <MessageResponse isAnimating={isAnimating}>{part.text}</MessageResponse>
      </MessageContent>
    );
  }

  if (part.type === "reasoning") return null;

  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
    const toolPart = part as ToolPart;
    const name = toolPart.toolName ?? part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
    const state = toolPart.state ?? "";
    const input = toolPart.input ?? toolPart.rawInput;
    const errorText =
      toolPart.errorText ?? (toolPart.error != null ? formatDetail(toolPart.error) : "");
    const displayLabel = toolDisplayLabel(name, input, state);
    if (toolPart.approval && !toolPart.approval.isAutomatic) {
      const approval = toolPart.approval;
      const detail = toolApprovalDetail(name, input);
      return (
        <Confirmation approval={approval} state={state}>
          <ConfirmationRequest>
            <ConfirmationTitle>{displayLabel}</ConfirmationTitle>
            {detail ? <p className="font-mono text-xs text-[#c8c8c8]">{detail}</p> : null}
            <ConfirmationActions>
              <ConfirmationAction variant="primary" onClick={() => onApprove(approval.id, true)}>
                Approve
              </ConfirmationAction>
              <ConfirmationAction variant="outline" onClick={() => onApprove(approval.id, false)}>
                Deny
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <ConfirmationTitle>Approved · {displayLabel}</ConfirmationTitle>
            {detail ? <p className="font-mono text-xs text-[#8f8f8f]">{detail}</p> : null}
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <ConfirmationTitle>Declined · {displayLabel}</ConfirmationTitle>
            {detail ? <p className="font-mono text-xs text-[#8f8f8f]">{detail}</p> : null}
          </ConfirmationRejected>
        </Confirmation>
      );
    }
    if (name === "messageBot" || name === "handoffStatus") return null;
    if (name === "requestTakeover") {
      const reason = inputValue(input, "reason");
      const failed = state === "output-error";
      return (
        <Alert variant={failed ? "destructive" : "warning"}>
          <WarningCircleIcon weight="fill" />
          <AlertTitle>{failed ? "Couldn't request your help" : "Requested your help"}</AlertTitle>
          <AlertDescription>
            {failed
              ? errorText || "The computer could not be handed over."
              : `${reason ? `${reason} ` : ""}Take control of the computer to continue.`}
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  }

  return null;
}

function formatDetail(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function toolDisplayLabel(
  name: string,
  input: unknown,
  state: string,
  liveHandoff?: HandoffSnapshot,
  bots?: Bot[],
) {
  const completed = state === "output-available";
  const failed = state === "output-error";
  const denied = state === "output-denied";
  const action = inputValue(input, "action");

  if (name === "messageBot") {
    const botId = inputValue(input, "botId");
    const teammate =
      liveHandoff?.targetName ||
      bots?.find((item) => item.id === botId)?.name ||
      "a teammate";
    if (failed || liveHandoff?.status === "error") return `Couldn't reach ${teammate}`;
    if (liveHandoff?.status === "running") return `${teammate} is working`;
    return completed ? `Asked ${teammate}` : `Asking ${teammate}`;
  }

  if (denied) return "Action was declined";

  if (name === "browser" || name.toLowerCase().includes("browser")) {
    switch (action) {
      case "navigate":
        if (failed) return "Couldn't open the page";
        return completed ? `Opened page` : `Opening page`;
      case "snapshot":
        if (failed) return "Couldn't read the page";
        return completed ? "Read the page" : "Reading the page";
      case "click":
        if (failed) return "Couldn't click the page";
        return completed ? "Clicked the page" : "Clicking the page";
      case "type":
        if (failed) return "Couldn't enter the text";
        return completed ? "Entered text" : "Entering text";
      case "press": {
        const key = inputValue(input, "key") ?? "a key";
        if (failed) return `Couldn't press ${key}`;
        return completed ? `Pressed ${key}` : `Pressing ${key}`;
      }
      case "scroll": {
        const dy = inputNumber(input, "dy");
        const direction = dy != null && dy < 0 ? "up" : "down";
        if (failed) return "Couldn't scroll the page";
        return completed ? `Scrolled ${direction}` : `Scrolling ${direction}`;
      }
      default:
        return failed
          ? "Couldn't use the browser"
          : completed
            ? "Used the browser"
            : "Using the browser";
    }
  }

  const labels: Record<string, [present: string, past: string]> = {
    workspace: ["Updating files", "Updated files"],
    runCommand: ["Running a command", "Ran a command"],
    stopSandbox: ["Stopping the computer", "Stopped the computer"],
    remember: ["Saving a memory", "Saved a memory"],
    saveSkill: ["Saving a skill", "Saved a skill"],
    listSkills: ["Checking saved skills", "Checked saved skills"],
    readSkill: ["Reading a skill", "Read a skill"],
    scheduleRoutine: ["Scheduling a routine", "Scheduled a routine"],
    listRoutines: ["Checking routines", "Checked routines"],
    pauseRoutine: ["Updating a routine", "Updated a routine"],
    messageBot: ["Asking a teammate", "Asked a teammate"],
    handoffStatus: ["Checking a teammate", "Checked a teammate"],
    requestTakeover: ["Waiting for your help", "Requested your help"],
  };
  const [present, past] = labels[name] ?? [
    `Working on ${humanizeToolName(name)}`,
    `Finished ${humanizeToolName(name)}`,
  ];
  if (failed) return `Couldn't ${present.charAt(0).toLowerCase()}${present.slice(1)}`;
  return completed ? past : present;
}

function toolApprovalDetail(name: string, input: unknown) {
  if (name === "runCommand") return snippet(inputValue(input, "command"));
  if (name === "workspace") {
    const path = inputValue(input, "path");
    return path ? snippet(path) : undefined;
  }
  return undefined;
}

function snippet(value?: string, max = 72) {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function RunModePicker({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (mode: RunMode) => void;
}) {
  const current = RUN_MODES[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-md px-1.5 py-1 text-left text-xs text-[#8f8f8f] hover:bg-white/5 hover:text-[#f0f0f0]"
        >
          {current.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        {(Object.values(RUN_MODES) as (typeof RUN_MODES)[RunMode][]).map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            onSelect={() => onChange(mode.id)}
            className={mode.id === value ? "bg-[#2d2d2d]" : undefined}
          >
            <span className="flex min-w-0 flex-col">
              <span>{mode.label}</span>
              <span className="text-[11px] text-[#8f8f8f]">{mode.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function inputValue(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function inputNumber(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function browserPageName(input: unknown) {
  const url = inputValue(input, "url");
  if (!url) return "the page";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch {
    return "the page";
  }
}

function humanizeToolName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}

function isToolRunning(state: string) {
  return (
    state === "input-streaming" || state === "input-available" || state === "approval-responded"
  );
}

function AnimatedDots() {
  return (
    <span aria-label="in progress" className="animated-dots ml-1" role="img">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
