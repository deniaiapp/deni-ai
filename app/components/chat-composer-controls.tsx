import { BrainIcon, ChevronDownIcon, RocketIcon, SparklesIcon } from "lucide-react";
import { useExtracted, useLocale } from "@/i18n/react";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dropdown-menu";
import {
  RUN_LEVELS,
  RUN_MODES,
  joinRunMode,
  splitRunMode,
  type RunLevel,
  type RunMode,
} from "@/lib/model";
import { cn } from "@/lib/utils";

type RunModeControlProps = {
  value: RunMode;
  onChange: (mode: RunMode) => void | Promise<void>;
};

function useRunLevelLabels(): Record<RunLevel, string> {
  const t = useExtracted();
  return { default: t("Default"), high: t("High"), xhigh: t("xhigh"), max: t("Max") };
}

function isRunLevel(value: unknown): value is RunLevel {
  return typeof value === "string" && (RUN_LEVELS as readonly string[]).includes(value);
}

/** Run or Run+, in the place of Deni AI's model picker. */
export function RunFamilyPicker({ value, onChange }: RunModeControlProps) {
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
      icon: RocketIcon,
      description: t("A stronger model for harder, longer tasks · ~{multiplier}× cost", {
        multiplier: String(RUN_MODES[joinRunMode(true, "default")].costMultiplier),
      }),
    },
  ];
  const selected = families.find((family) => family.plus === plus) ?? families[0];
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
              "h-auto gap-1.5 border-none bg-transparent px-2 py-1.5 font-medium text-muted-foreground shadow-none transition-colors dark:bg-input/30",
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
                if (family.plus !== plus) void onChange(joinRunMode(family.plus, level));
              }}
              className={cn(
                "flex-col items-start gap-1 p-2",
                family.plus === plus && "bg-surface-active",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium text-sm leading-none">
                <Icon className="size-3.5" aria-hidden="true" />
                {family.name}
              </span>
              <span className="pl-5 text-muted-foreground text-xs leading-snug">
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
        if (isRunLevel(next) && next !== level) void onChange(joinRunMode(plus, next));
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

/** The reasoning level, in the place of Deni AI's reasoning effort select. */
export function RunLevelSelect({ value, onChange }: RunModeControlProps) {
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

/** Tools row under the text: the model, then the reasoning level on wider screens. */
export function ChatComposerTools(props: RunModeControlProps) {
  return (
    <>
      <RunFamilyPicker {...props} />
      <div className="hidden md:flex md:items-center md:gap-1">
        <RunLevelSelect {...props} />
      </div>
    </>
  );
}

/** Items in the + menu. On narrow screens the reasoning level moves here from the tools row. */
export function ChatComposerActionMenu(props: RunModeControlProps) {
  const t = useExtracted();
  const labels = useRunLevelLabels();

  return (
    <div className="md:hidden">
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <BrainIcon className="size-4" aria-hidden="true" />
          {t("Reasoning level")}
          <span className="ml-auto pl-2 text-muted-foreground text-xs">
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

export function ChatComposerVoiceInput({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const t = useExtracted();
  const locale = useLocale();

  return (
    <SpeechInput
      size="icon-sm"
      variant="ghost"
      lang={locale === "ja" ? "ja-JP" : "en-US"}
      className="size-8 shrink-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={t("Voice input")}
      title={t("Voice input")}
      onTranscriptionChange={(transcript) => {
        const nextValue = value.trim() ? `${value.trim()} ${transcript}` : transcript;
        onValueChange(nextValue.trim());
      }}
    />
  );
}
