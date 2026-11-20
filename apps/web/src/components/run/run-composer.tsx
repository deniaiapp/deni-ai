import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UsersIcon } from "lucide-react";
import { useExtracted } from "use-intl";
import { getPreferredReasoningEffort } from "@deniai/ai/models";
import { joinRunMode, parseRunMode, splitRunMode, type RunMode } from "@deniai/run/agent/model";
import {
  WEB_ATTACHMENT_COUNT,
  WEB_ATTACHMENT_LIMIT,
  type MessageAttachment,
} from "@deniai/run/chat/message-attachments";
import {
  ChatComposerReasoningSelect,
  ChatComposerVoiceInput,
} from "@/components/chat/chat-composer-controls";
import { ChatComposerModelPicker } from "@/components/chat/chat-composer-model-picker";
import { Composer } from "@/components/chat/composer";
import { useAvailableModels } from "@/hooks/use-available-models";
import type { UploadedAttachment } from "@/lib/upload-attachment-client";
import { cn } from "@/lib/utils";
import { RunApiError, runFetch, runKeys, type Bot, type RunState } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { TeammateAvatar } from "./teammate-avatar";

/** What the Run message box sends: the text and the files saved in the workspace for it. */
export type RunComposerMessage = { text: string; attachments: MessageAttachment[] };

/** The `metadata` of a user message that carries these files (undefined without files). */
export function attachmentMetadata(attachments: MessageAttachment[]) {
  return attachments.length ? { attachments } : undefined;
}

/** Saves a file to the teammate's workspace (`POST /api/run/attachments`). */
async function uploadRunAttachment(file: File): Promise<MessageAttachment> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/run/attachments", { method: "POST", body });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RunApiError(response.status, detail.error ?? `http_${response.status}`, detail);
  }
  const payload = (await response.json().catch(() => ({}))) as { attachment?: MessageAttachment };
  if (!payload.attachment) throw new RunApiError(response.status, "invalid_response");
  return payload.attachment;
}

/** The account's Run mode (a chat catalog model and a reasoning level), saved as the default on change. */
export function useRunMode(state: RunState | undefined) {
  const queryClient = useQueryClient();
  const saved = parseRunMode(state?.runMode);
  const [local, setLocal] = useState<RunMode | null>(null);
  const runMode = local ?? saved;
  const setRunMode = (mode: RunMode) => {
    setLocal(mode);
    queryClient.setQueryData<RunState>(runKeys.state, (current) =>
      current ? { ...current, runMode: mode } : current,
    );
    void runFetch("state", { method: "PATCH", body: { runMode: mode } }).catch(() => undefined);
  };
  return [runMode, setRunMode] as const;
}

/**
 * The model and the reasoning level of Run: the chat model picker and reasoning select, over
 * the models the plan allows in chat. The choice is Run's own setting, shared with Discord.
 */
function RunModelControls({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (mode: RunMode) => void;
}) {
  const t = useExtracted();
  const { availableModels } = useAvailableModels();
  const { model, reasoningEffort } = splitRunMode(value);
  const selectedModel = availableModels.find((item) => item.value === model);
  const efforts = selectedModel?.efforts ?? false;

  return (
    <>
      <ChatComposerModelPicker
        model={model}
        // The reasoning level follows the new model: joinRunMode keeps it when supported.
        onModelChange={(next) => onChange(joinRunMode(next, reasoningEffort))}
        availableModels={availableModels}
        selectedModel={selectedModel}
        ariaLabel={t("Model")}
      />
      <ChatComposerReasoningSelect
        reasoningEffort={reasoningEffort ?? getPreferredReasoningEffort(efforts)}
        onReasoningEffortChange={(effort) => onChange(joinRunMode(model, effort))}
        supportedEfforts={efforts}
        supportsReasoningEffort={efforts !== false}
      />
    </>
  );
}

type MentionOption = { id: string; name: string; accent?: string; icon?: string | null };

/**
 * The Run message box: the chat `Composer` (text, attachments, voice input, submit / stop), the
 * chat model picker and reasoning select and, in groups, `@name` suggestions. Attached files
 * are saved to the teammate's workspace instead of the chat store.
 */
export function RunComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder,
  runMode,
  onRunModeChange,
  mentions,
  extraTools,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (message: RunComposerMessage) => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder: string;
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void;
  /** Group members; enables `@name` suggestions while typing. */
  mentions?: Bot[];
  /** Shown before the Run controls in the tools row (the home page's teammate picker). */
  extraTools?: ReactNode;
  className?: string;
}) {
  const t = useExtracted();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const errorText = useRunErrorText();
  // Uploaded files by workspace path: the composer hands back file parts, the message needs these.
  const uploaded = useRef(new Map<string, MessageAttachment>());
  const uploadFile = async (file: File): Promise<UploadedAttachment> => {
    try {
      const attachment = await uploadRunAttachment(file);
      uploaded.current.set(attachment.path, attachment);
      return { file, url: attachment.path, mediaType: attachment.mediaType };
    } catch (error) {
      throw new Error(errorText(error), { cause: error });
    }
  };

  const prefix = mentions && cursor >= 0 ? value.slice(0, cursor) : "";
  const mention = mentions ? prefix.match(/(?:^|\s)@([^@\n]{0,48})$/) : null;
  const options: MentionOption[] = mention
    ? [{ id: "everyone", name: "everyone" }, ...(mentions ?? [])].filter((member) =>
        member.name.toLowerCase().startsWith((mention[1] ?? "").toLowerCase()),
      )
    : [];

  const textarea = () => wrapperRef.current?.querySelector("textarea") ?? null;
  const trackCursor = (target: EventTarget) => {
    if (target instanceof HTMLTextAreaElement) {
      setCursor(target.selectionStart);
      setMentionIndex(0);
    }
  };

  const insertMention = (name: string) => {
    const start = prefix.lastIndexOf("@");
    if (start < 0) return;
    const next = `${value.slice(0, start)}@${name} ${value.slice(cursor)}`;
    const position = start + name.length + 2;
    onValueChange(next);
    setCursor(-1);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const element = textarea();
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  return (
    <div
      ref={wrapperRef}
      className={cn("relative w-full", className)}
      onClickCapture={(event) => trackCursor(event.target)}
      onInputCapture={(event) => trackCursor(event.target)}
      onKeyUpCapture={(event) => {
        if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key))
          trackCursor(event.target);
      }}
      onKeyDownCapture={(event) => {
        if (!options.length || event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setMentionIndex(
            (current) =>
              (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length,
          );
        } else if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          insertMention(options[Math.min(mentionIndex, options.length - 1)]!.name);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setCursor(-1);
        }
      }}
    >
      {options.length ? (
        <div
          role="listbox"
          aria-label={t("Mention a teammate")}
          className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-72 max-w-full overflow-y-auto rounded-menu border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {options.map((member, index) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(member.name)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
                index === mentionIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              {member.id === "everyone" ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                  <UsersIcon className="size-3.5" />
                </span>
              ) : (
                <TeammateAvatar
                  name={member.name}
                  icon={member.icon}
                  accent={member.accent}
                  size="sm"
                />
              )}
              <span>@{member.name}</span>
              {member.id === "everyone" ? (
                <span className="ml-auto text-xs text-muted-foreground">{t("All teammates")}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <Composer
        value={value}
        onValueChange={onValueChange}
        onSubmit={(message) => {
          const text = value.trim();
          if (!text || busy || disabled) return;
          setCursor(-1);
          const attachments = message.files.flatMap((file) => {
            const attachment = uploaded.current.get(file.url);
            return attachment ? [attachment] : [];
          });
          uploaded.current.clear();
          onSubmit({ text, attachments });
        }}
        onStop={onStop}
        status={busy ? "streaming" : "ready"}
        isSubmitDisabled={busy ? false : disabled || !value.trim()}
        placeholder={placeholder}
        headerClassName="py-0!"
        globalDrop
        multiple
        maxFiles={WEB_ATTACHMENT_COUNT}
        maxFileSize={WEB_ATTACHMENT_LIMIT}
        uploadFile={uploadFile}
        voiceInput={<ChatComposerVoiceInput value={value} onValueChange={onValueChange} />}
        tools={
          <>
            {extraTools}
            <RunModelControls value={runMode} onChange={onRunModeChange} />
          </>
        }
      />
    </div>
  );
}
