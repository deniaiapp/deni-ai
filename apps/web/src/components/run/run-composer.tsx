import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrainIcon,
  ChevronDownIcon,
  Zap as ZapIcon,
  Sparkles as SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { useExtracted } from "use-intl";
import {
  RUN_LEVELS,
  RUN_MODES,
  joinRunMode,
  parseRunMode,
  splitRunMode,
  type RunLevel,
  type RunMode,
} from "@deniai/run/agent/model";
import { Button } from "@deniai/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@deniai/ui/components/dropdown-menu";
import { ChatComposerVoiceInput } from "@/components/chat/chat-composer-controls";
import { Composer } from "@/components/chat/composer";
import { cn } from "@/lib/utils";
import { runFetch, runKeys, type Bot, type RunState } from "./run-api";
import { TeammateAvatar } from "./teammate-avatar";

type RunModeControlProps = {
  value: RunMode;
  onChange: (mode: RunMode) => void;
};

/** The account's Run mode (Run / Run+ and the reasoning level), saved as the default on change. */
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

function useRunLevelLabels(): Record<RunLevel, string> {
  const t = useExtracted();
  return { default: t("Default"), high: t("High"), xhigh: t("xhigh"), max: t("Max") };
}

function isRunLevel(value: unknown): value is RunLevel {
  return typeof value === "string" && (RUN_LEVELS as readonly string[]).includes(value);
}

/** Run or Run+, in the place of the chat model picker. */
function RunFamilyPicker({ value, onChange }: RunModeControlProps) {
  const t = useExtracted();
  const { plus, level } = splitRunMode(value);
  const families = [
    {
      plus: false,
      name: "Run",
      icon: SparklesIcon,
      description: t("Fast and capable for everyday work"),
    },
    {
      plus: true,
      name: "Run+",
      icon: ZapIcon,
      description: t("A stronger model for harder, longer tasks · ~{multiplier}× cost", {
        multiplier: String(RUN_MODES[joinRunMode(true, "default")].costMultiplier),
      }),
    },
  ];
  const selected = families.find((family) => family.plus === plus) ?? families[0]!;
  const SelectedIcon = selected.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("Model")}
            className={cn(
              "h-auto gap-1.5 border-none bg-transparent px-2 py-1.5 font-medium text-muted-foreground shadow-none transition-colors",
              "hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground",
            )}
          />
        }
      >
        <SelectedIcon className="size-3.5" aria-hidden="true" />
        <span className="max-w-30 truncate text-sm">{selected.name}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        {families.map((family) => {
          const Icon = family.icon;
          return (
            <DropdownMenuItem
              key={family.name}
              onClick={() => {
                if (family.plus !== plus) onChange(joinRunMode(family.plus, level));
              }}
              className={cn("flex-col items-start gap-1 p-2", family.plus === plus && "bg-accent")}
            >
              <span className="flex items-center gap-1.5 text-sm leading-none font-medium">
                <Icon className="size-3.5" aria-hidden="true" />
                {family.name}
              </span>
              <span className="pl-5 text-xs leading-snug text-muted-foreground">
                {family.description}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RunLevelItems({ value, onChange }: RunModeControlProps) {
  const t = useExtracted();
  const labels = useRunLevelLabels();
  const { plus, level } = splitRunMode(value);

  return (
    <DropdownMenuRadioGroup
      value={level}
      onValueChange={(next) => {
        if (isRunLevel(next) && next !== level) onChange(joinRunMode(plus, next));
      }}
    >
      {RUN_LEVELS.map((id) => (
        <DropdownMenuRadioItem key={id} value={id}>
          <span className="flex min-w-0 flex-col">
            <span>{labels[id]}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("~{multiplier}× cost", {
                multiplier: String(RUN_MODES[joinRunMode(plus, id)].costMultiplier),
              })}
            </span>
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** The reasoning level, in the place of the chat reasoning effort select. */
function RunLevelSelect({ value, onChange }: RunModeControlProps) {
  const t = useExtracted();
  const labels = useRunLevelLabels();
  const { level } = splitRunMode(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("Reasoning level")}
            className={cn(
              "gap-1.5 border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors",
              "hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground",
            )}
          />
        }
      >
        <BrainIcon className="size-4" aria-hidden="true" />
        {labels[level]}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-44">
        <RunLevelItems value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Items in the + menu. On narrow screens the reasoning level moves here from the tools row. */
function RunComposerActionMenu(props: RunModeControlProps) {
  const t = useExtracted();
  const labels = useRunLevelLabels();

  return (
    <div className="md:hidden">
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <BrainIcon className="size-4" aria-hidden="true" />
          {t("Reasoning level")}
          <span className="ml-auto pl-2 text-xs text-muted-foreground">
            {labels[splitRunMode(props.value).level]}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <RunLevelItems {...props} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  );
}

type MentionOption = { id: string; name: string; accent?: string; icon?: string | null };

/**
 * The Run message box: the Deni AI composer with Run / Run+ in place of the model picker, the
 * reasoning level, voice input and, in groups, `@name` suggestions.
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
  onSubmit: (text: string) => void;
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
        onSubmit={() => {
          const text = value.trim();
          if (!text || busy || disabled) return;
          setCursor(-1);
          onSubmit(text);
        }}
        onStop={onStop}
        status={busy ? "streaming" : "ready"}
        isSubmitDisabled={busy ? false : disabled || !value.trim()}
        placeholder={placeholder}
        attachmentsEnabled={false}
        actionMenuItems={<RunComposerActionMenu value={runMode} onChange={onRunModeChange} />}
        voiceInput={<ChatComposerVoiceInput value={value} onValueChange={onValueChange} />}
        tools={
          <>
            {extraTools}
            <RunFamilyPicker value={runMode} onChange={onRunModeChange} />
            <div className="hidden md:flex md:items-center md:gap-1">
              <RunLevelSelect value={runMode} onChange={onRunModeChange} />
            </div>
          </>
        }
      />
    </div>
  );
}
