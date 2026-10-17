"use client";

import {
  ArrowUpRight,
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
  RotateCcw,
  Send,
} from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  useIntelligentUiActions,
  useIntelligentUiMessage,
} from "@/components/chat/intelligent-ui/intelligent-ui-context";
import { compileExpression, evaluateExpression } from "@/lib/intelligent-ui/expression";
import { formatIntelligentUiNumber, hashString } from "@/lib/intelligent-ui/format";
import type { IntelligentUiBlockOf } from "@/lib/intelligent-ui/schema";
import { toSafeHref } from "@/lib/safe-href";
import { cn } from "@/lib/utils";

const nativeSelectClassName =
  "h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

function useCopyToClipboard() {
  const t = useExtracted();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(0);
  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("Copy failed"));
    }
  };
  return { copied, copy };
}

/* Checklist ticks are a per-viewer convenience, kept in local storage per message. */

const CHECKLIST_EVENT = "deni:iui-checklist";
const unpersistedChecklists = new Map<string, string>();

function subscribeChecklist(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHECKLIST_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHECKLIST_EVENT, onStoreChange);
  };
}

function readChecklist(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return unpersistedChecklists.get(key) ?? null;
  }
}

function writeChecklist(key: string, value: string) {
  unpersistedChecklists.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The in-memory copy keeps the ticks for this page.
  }
  window.dispatchEvent(new Event(CHECKLIST_EVENT));
}

export function IntelligentUiChecklist({ block }: { block: IntelligentUiBlockOf<"checklist"> }) {
  const t = useExtracted();
  const { messageId } = useIntelligentUiMessage();
  const baseId = useId();
  const { copied, copy } = useCopyToClipboard();
  const storageKey = `deni-iui-checklist:${messageId ?? "none"}:${hashString(
    JSON.stringify(block.items.map((item) => item.label)),
  )}`;
  const stored = useSyncExternalStore(
    subscribeChecklist,
    () => readChecklist(storageKey),
    () => null,
  );
  let checked = block.items.map((item) => item.checked === true);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === block.items.length) {
        checked = parsed.map(Boolean);
      }
    } catch {
      // Ignore a corrupt entry and show the defaults.
    }
  }
  const done = checked.filter(Boolean).length;

  const toggle = (index: number, value: boolean) => {
    writeChecklist(
      storageKey,
      JSON.stringify(checked.map((current, itemIndex) => (itemIndex === index ? value : current))),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Progress
          aria-label={t("Checklist progress")}
          className="flex-1"
          value={(done / block.items.length) * 100}
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t("{done} of {total}", { done: String(done), total: String(block.items.length) })}
        </span>
      </div>
      <ul className="space-y-1">
        {block.items.map((item, index) => {
          const id = `${baseId}-${index}`;
          return (
            <li key={`${item.label}-${index}`}>
              <label
                className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
                htmlFor={id}
              >
                <Checkbox
                  checked={checked[index]}
                  className="mt-0.5"
                  id={id}
                  onCheckedChange={(value) => toggle(index, value === true)}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm transition-colors",
                      checked[index] && "text-muted-foreground line-through",
                    )}
                  >
                    {item.label}
                  </span>
                  {item.detail ? (
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() =>
            void copy(
              block.items
                .map((item, index) => `${checked[index] ? "[x]" : "[ ]"} ${item.label}`)
                .join("\n"),
            )
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? t("Copied") : t("Copy list")}
        </Button>
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: IntelligentUiBlockOf<"actions">["items"][number] }) {
  const { sendPrompt } = useIntelligentUiActions();
  const { copied, copy } = useCopyToClipboard();
  if (action.url) {
    return (
      <Button
        className="gap-1.5"
        render={<a href={toSafeHref(action.url)} rel="noopener noreferrer" target="_blank" />}
        size="sm"
        variant="outline"
        nativeButton={false}
      >
        {action.label}
        <ArrowUpRight className="size-3.5" />
      </Button>
    );
  }
  if (action.copy !== undefined) {
    const value = action.copy;
    return (
      <Button
        className="gap-1.5"
        onClick={() => void copy(value)}
        size="sm"
        type="button"
        variant="outline"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {action.label}
      </Button>
    );
  }
  const prompt = action.prompt ?? "";
  return (
    <Button
      className="h-auto min-h-8 gap-1.5 py-1.5 text-left whitespace-normal"
      disabled={!sendPrompt}
      onClick={() => sendPrompt?.(prompt)}
      size="sm"
      type="button"
      variant="outline"
    >
      {action.label}
    </Button>
  );
}

export function IntelligentUiActions({ block }: { block: IntelligentUiBlockOf<"actions"> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {block.items.map((action, index) => (
        <ActionButton key={`${action.label}-${index}`} action={action} />
      ))}
    </div>
  );
}

export function IntelligentUiCards({ block }: { block: IntelligentUiBlockOf<"cards"> }) {
  const { sendPrompt } = useIntelligentUiActions();
  return (
    <div className={cn("grid gap-2", block.items.length > 1 && "sm:grid-cols-2")}>
      {block.items.map((card, index) => {
        const body = (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium leading-snug">{card.title}</p>
                {card.subtitle ? (
                  <p className="text-xs text-muted-foreground">{card.subtitle}</p>
                ) : null}
              </div>
              {card.badge ? (
                <Badge className="shrink-0" variant="secondary">
                  {card.badge}
                </Badge>
              ) : null}
            </div>
            {card.description ? (
              <p className="mt-1.5 text-sm text-muted-foreground">{card.description}</p>
            ) : null}
            {card.url ? (
              <ArrowUpRight
                aria-hidden
                className="absolute right-3 bottom-3 size-3.5 text-muted-foreground"
              />
            ) : null}
          </>
        );
        const className =
          "relative block rounded-lg border bg-background/60 p-3 text-left transition-colors";
        if (card.url) {
          return (
            <a
              key={`${card.title}-${index}`}
              className={cn(className, "pr-8 hover:bg-muted/60")}
              href={toSafeHref(card.url)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {body}
            </a>
          );
        }
        if (card.prompt) {
          const prompt = card.prompt;
          return (
            <button
              key={`${card.title}-${index}`}
              className={cn(className, "w-full hover:bg-muted/60 disabled:opacity-60")}
              disabled={!sendPrompt}
              onClick={() => sendPrompt?.(prompt)}
              type="button"
            >
              {body}
            </button>
          );
        }
        return (
          <div key={`${card.title}-${index}`} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function clampToInput(value: number, input: IntelligentUiBlockOf<"calculator">["inputs"][number]) {
  let next = value;
  if (input.min !== undefined) next = Math.max(next, input.min);
  if (input.max !== undefined) next = Math.min(next, input.max);
  return next;
}

function CalculatorInput({
  input,
  value,
  onChange,
}: {
  input: IntelligentUiBlockOf<"calculator">["inputs"][number];
  value: number;
  onChange: (value: number) => void;
}) {
  const t = useExtracted();
  const id = useId();
  const step = input.step ?? 1;
  const control =
    input.control === "slider" && (input.min === undefined || input.max === undefined)
      ? "number"
      : input.control;
  const unit = input.unit ? (
    <span className="shrink-0 text-xs text-muted-foreground">{input.unit}</span>
  ) : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={id}>
          {input.label}
        </label>
        {control === "slider" ? (
          <span className="text-sm tabular-nums text-muted-foreground">
            {value}
            {input.unit ? ` ${input.unit}` : null}
          </span>
        ) : null}
      </div>
      {control === "select" && input.options ? (
        <select
          className={nativeSelectClassName}
          id={id}
          onChange={(event) => onChange(Number(event.target.value))}
          value={value}
        >
          {input.options.map((option, index) => (
            <option key={`${option.label}-${index}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : control === "slider" ? (
        <Slider
          id={id}
          max={input.max}
          min={input.min}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
          step={step}
          value={[value]}
        />
      ) : control === "stepper" ? (
        <div className="flex items-center gap-2">
          <Button
            aria-label={t("Decrease {label}", { label: input.label })}
            disabled={input.min !== undefined && value <= input.min}
            onClick={() => onChange(clampToInput(Number((value - step).toPrecision(12)), input))}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <MinusIcon />
          </Button>
          <Input
            className="h-8 w-20 text-center tabular-nums"
            id={id}
            inputMode="decimal"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (event.target.value !== "" && Number.isFinite(next)) onChange(next);
            }}
            onBlur={() => onChange(clampToInput(value, input))}
            type="number"
            value={value}
          />
          <Button
            aria-label={t("Increase {label}", { label: input.label })}
            disabled={input.max !== undefined && value >= input.max}
            onClick={() => onChange(clampToInput(Number((value + step).toPrecision(12)), input))}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <PlusIcon />
          </Button>
          {unit}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            className="tabular-nums"
            id={id}
            inputMode="decimal"
            max={input.max}
            min={input.min}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange(event.target.value === "" || !Number.isFinite(next) ? Number.NaN : next);
            }}
            step={input.step ?? "any"}
            type="number"
            value={Number.isNaN(value) ? "" : value}
          />
          {unit}
        </div>
      )}
    </div>
  );
}

export function IntelligentUiCalculator({ block }: { block: IntelligentUiBlockOf<"calculator"> }) {
  const t = useExtracted();
  const locale = useLocale();
  const initialValues = () =>
    Object.fromEntries(block.inputs.map((input) => [input.id, input.value]));
  const [values, setValues] = useState<Record<string, number>>(initialValues);
  // The schema already rejected formulas that do not compile.
  const outputs = block.outputs.map((output) => {
    let result = Number.NaN;
    try {
      result = evaluateExpression(compileExpression(output.formula).ast, values);
    } catch {
      // Leave the result as NaN, shown as a dash.
    }
    return { ...output, result };
  });
  const isDirty = block.inputs.some((input) => values[input.id] !== input.value);

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        {block.inputs.map((input) => (
          <CalculatorInput
            key={input.id}
            input={input}
            onChange={(next) => setValues((current) => ({ ...current, [input.id]: next }))}
            value={values[input.id]}
          />
        ))}
        {isDirty ? (
          <Button
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setValues(initialValues())}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw className="size-3.5" />
            {t("Reset")}
          </Button>
        ) : null}
      </div>
      <dl aria-live="polite" className="space-y-1 rounded-lg bg-muted/60 p-3">
        {outputs.map((output, index) => (
          <div
            key={`${output.label}-${index}`}
            className={cn(
              "flex items-baseline justify-between gap-3 py-1",
              output.highlight && "border-t pt-2 first:border-t-0 first:pt-1",
            )}
          >
            <dt
              className={cn("text-sm text-muted-foreground", output.highlight && "text-foreground")}
            >
              {output.label}
            </dt>
            <dd
              className={cn(
                "text-right tabular-nums",
                output.highlight ? "text-xl font-semibold" : "text-sm font-medium",
              )}
            >
              {formatIntelligentUiNumber(output.result, locale, output)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function IntelligentUiForm({ block }: { block: IntelligentUiBlockOf<"form"> }) {
  const t = useExtracted();
  const baseId = useId();
  const { sendPrompt } = useIntelligentUiActions();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sendPrompt) return;
    const data = new FormData(event.currentTarget);
    const prompt = block.prompt.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = data.get(name);
      return typeof value === "string" && value.trim() ? value.trim() : "—";
    });
    sendPrompt(prompt);
    setSubmitted(true);
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <fieldset className="space-y-3" disabled={submitted}>
        {block.fields.map((field) => {
          const id = `${baseId}-${field.id}`;
          return (
            <div key={field.id} className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={id}>
                {field.label}
                {field.required ? <span className="text-muted-foreground"> *</span> : null}
              </label>
              {field.input === "select" && field.options ? (
                <select
                  className={nativeSelectClassName}
                  defaultValue={field.options[0]}
                  id={id}
                  name={field.id}
                  required={field.required}
                >
                  {field.options.map((option, index) => (
                    <option key={`${option}-${index}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.input === "textarea" ? (
                <Textarea
                  id={id}
                  maxLength={2000}
                  name={field.id}
                  placeholder={field.placeholder}
                  required={field.required}
                  rows={3}
                />
              ) : (
                <Input
                  id={id}
                  inputMode={field.input === "number" ? "decimal" : undefined}
                  maxLength={500}
                  name={field.id}
                  placeholder={field.placeholder}
                  required={field.required}
                  step={field.input === "number" ? "any" : undefined}
                  type={field.input === "number" ? "number" : "text"}
                />
              )}
            </div>
          );
        })}
      </fieldset>
      <div className="flex items-center justify-end gap-2">
        {submitted ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckIcon className="size-3.5" />
            {t("Sent")}
          </span>
        ) : null}
        <Button className="gap-1.5" disabled={!sendPrompt || submitted} size="sm" type="submit">
          <Send className="size-3.5" />
          {block.submitLabel ?? t("Send")}
        </Button>
      </div>
    </form>
  );
}

export function IntelligentUiQuiz({ block }: { block: IntelligentUiBlockOf<"quiz"> }) {
  const t = useExtracted();
  const [answers, setAnswers] = useState<(number | null)[]>(() => block.questions.map(() => null));
  const answered = answers.filter((answer) => answer !== null).length;
  const score = answers.filter((answer, index) => answer === block.questions[index].answer).length;

  return (
    <div className="space-y-5">
      {block.questions.map((question, questionIndex) => {
        const selected = answers[questionIndex];
        const isAnswered = selected !== null;
        return (
          <div key={`${question.question}-${questionIndex}`} className="space-y-2">
            <p className="text-sm font-medium">
              <span className="mr-1.5 text-muted-foreground tabular-nums">
                {questionIndex + 1}.
              </span>
              {question.question}
            </p>
            <div className="grid gap-1.5">
              {question.choices.map((choice, choiceIndex) => {
                const isCorrect = choiceIndex === question.answer;
                const isSelected = selected === choiceIndex;
                return (
                  <button
                    key={`${choice}-${choiceIndex}`}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      !isAnswered && "hover:bg-muted/60",
                      isAnswered && isCorrect && "border-[var(--iui-good)] bg-[var(--iui-good)]/10",
                      isAnswered &&
                        isSelected &&
                        !isCorrect &&
                        "border-[var(--iui-critical)] bg-[var(--iui-critical)]/10",
                      isAnswered && !isSelected && !isCorrect && "opacity-60",
                    )}
                    disabled={isAnswered}
                    onClick={() =>
                      setAnswers((current) =>
                        current.map((answer, index) =>
                          index === questionIndex ? choiceIndex : answer,
                        ),
                      )
                    }
                    type="button"
                  >
                    <span className="min-w-0 flex-1">{choice}</span>
                    {isAnswered && isCorrect ? (
                      <CircleCheckIcon className="size-4 shrink-0 text-[var(--iui-good)]">
                        <title>{t("Correct")}</title>
                      </CircleCheckIcon>
                    ) : null}
                    {isAnswered && isSelected && !isCorrect ? (
                      <CircleXIcon className="size-4 shrink-0 text-[var(--iui-critical)]">
                        <title>{t("Incorrect")}</title>
                      </CircleXIcon>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {isAnswered && question.explanation ? (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {question.explanation}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {answered === block.questions.length
            ? t("Score: {score} / {total}", {
                score: String(score),
                total: String(block.questions.length),
              })
            : t("{answered} of {total} answered", {
                answered: String(answered),
                total: String(block.questions.length),
              })}
        </span>
        {answered > 0 ? (
          <Button
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setAnswers(block.questions.map(() => null))}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw className="size-3.5" />
            {t("Try again")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
