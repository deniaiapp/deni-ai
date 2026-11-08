export const DENI_MODEL_ID = "anthropic/claude-sonnet-5.5";
export const DENI_REASONING_EFFORT = "medium";
export const DENI_MODEL_LABEL = "Run Default";

/** Summarizes history the model no longer sees. Haiku 5.5 costs 1/20 of Sonnet 5.5 per token. */
export const SUMMARY_MODEL_ID = "anthropic/claude-haiku-5.5";

/**
 * USD per million tokens. Only a fallback: usage is billed at the cost OpenRouter
 * reports for each request, and these apply when a response carries none.
 */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 3, output: 15 },
  "anthropic/claude-opus-5.5": { input: 6, output: 30 },
  "anthropic/claude-haiku-5.5": { input: 0.15, output: 0.75 },
};

export const RUN_MODE_IDS = [
  "default",
  "high",
  "xhigh",
  "max",
  "plus-default",
  "plus-high",
  "plus-xhigh",
  "plus-max",
] as const;
export type RunMode = (typeof RUN_MODE_IDS)[number];
export type ReasoningEffort = "medium" | "high" | "xhigh" | "max";

export const RUN_MODES: Record<
  RunMode,
  {
    id: RunMode;
    modelId: string;
    label: string;
    effort: ReasoningEffort;
    /** Approximate cost of a turn relative to Run Default, shown in the mode picker. */
    costMultiplier: number;
    hint: string;
  }
> = {
  default: {
    id: "default",
    modelId: DENI_MODEL_ID,
    label: "Run Default",
    effort: "medium",
    costMultiplier: 1,
    hint: "Default",
  },
  high: {
    id: "high",
    modelId: DENI_MODEL_ID,
    label: "Run High",
    effort: "high",
    costMultiplier: 1.2,
    hint: "1.2× cost",
  },
  xhigh: {
    id: "xhigh",
    modelId: DENI_MODEL_ID,
    label: "Run xhigh",
    effort: "xhigh",
    costMultiplier: 1.4,
    hint: "1.4× cost",
  },
  max: {
    id: "max",
    modelId: DENI_MODEL_ID,
    label: "Run Max",
    effort: "max",
    costMultiplier: 1.6,
    hint: "1.6× cost",
  },
  "plus-default": {
    id: "plus-default",
    modelId: "anthropic/claude-opus-5.5",
    label: "Run+ Default",
    effort: "medium",
    costMultiplier: 2,
    hint: "2× cost",
  },
  "plus-high": {
    id: "plus-high",
    modelId: "anthropic/claude-opus-5.5",
    label: "Run+ High",
    effort: "high",
    costMultiplier: 2.2,
    hint: "2.2× cost",
  },
  "plus-xhigh": {
    id: "plus-xhigh",
    modelId: "anthropic/claude-opus-5.5",
    label: "Run+ xhigh",
    effort: "xhigh",
    costMultiplier: 2.4,
    hint: "2.4× cost",
  },
  "plus-max": {
    id: "plus-max",
    modelId: "anthropic/claude-opus-5.5",
    label: "Run+ Max",
    effort: "max",
    costMultiplier: 2.6,
    hint: "2.6× cost",
  },
};

export function parseRunMode(value: unknown): RunMode {
  if (value === "plus") return "plus-max"; // Previously saved Run+ selection.
  if (typeof value === "string" && (RUN_MODE_IDS as readonly string[]).includes(value)) {
    return value as RunMode;
  }
  return "default";
}

export const RUN_LEVELS = ["default", "high", "xhigh", "max"] as const;
export type RunLevel = (typeof RUN_LEVELS)[number];

/** A run mode is a model family (Run or Run+) plus a reasoning level. */
export function splitRunMode(mode: RunMode): { plus: boolean; level: RunLevel } {
  return mode.startsWith("plus-")
    ? { plus: true, level: mode.slice("plus-".length) as RunLevel }
    : { plus: false, level: mode as RunLevel };
}

export function joinRunMode(plus: boolean, level: RunLevel): RunMode {
  return plus ? (`plus-${level}` as RunMode) : level;
}
