export const DENI_MODEL_ID = "openai/gpt-6-luna";
export const DENI_REASONING_EFFORT = "max";
export const DENI_MODEL_LABEL = "Run max";

export const RUN_MODE_IDS = ["default", "high", "xhigh", "max", "plus-default", "plus-high", "plus-xhigh", "plus-max"] as const;
export type RunMode = (typeof RUN_MODE_IDS)[number];
export type ReasoningEffort = "medium" | "high" | "xhigh" | "max";

export const RUN_MODES: Record<
  RunMode,
  {
    id: RunMode;
    modelId: string;
    label: string;
    effort: ReasoningEffort;
    tokenMultiplier: number;
    hint: string;
  }
> = {
  default: {
    id: "default",
    modelId: DENI_MODEL_ID,
    label: "Run Default",
    effort: "medium",
    tokenMultiplier: 0.5,
    hint: "0.5× tokens",
  },
  high: {
    id: "high",
    modelId: DENI_MODEL_ID,
    label: "Run High",
    effort: "high",
    tokenMultiplier: 0.8,
    hint: "0.8× tokens",
  },
  xhigh: {
    id: "xhigh",
    modelId: DENI_MODEL_ID,
    label: "Run xhigh",
    effort: "xhigh",
    tokenMultiplier: 0.9,
    hint: "0.9× tokens",
  },
  max: {
    id: "max",
    modelId: DENI_MODEL_ID,
    label: "Run Max",
    effort: "max",
    tokenMultiplier: 1,
    hint: "Default",
  },
  "plus-default": {
    id: "plus-default",
    modelId: "openai/gpt-6-sol",
    label: "Run+ Default",
    effort: "medium",
    tokenMultiplier: 10,
    hint: "10× tokens",
  },
  "plus-high": {
    id: "plus-high",
    modelId: "openai/gpt-6-sol",
    label: "Run+ High",
    effort: "high",
    tokenMultiplier: 16,
    hint: "16× tokens",
  },
  "plus-xhigh": {
    id: "plus-xhigh",
    modelId: "openai/gpt-6-sol",
    label: "Run+ xhigh",
    effort: "xhigh",
    tokenMultiplier: 18,
    hint: "18× tokens",
  },
  "plus-max": {
    id: "plus-max",
    modelId: "openai/gpt-6-sol",
    label: "Run+ Max",
    effort: "max",
    tokenMultiplier: 20,
    hint: "20× tokens",
  },
};

export function parseRunMode(value: unknown): RunMode {
  if (value === "plus") return "plus-max"; // Previously saved Run+ selection.
  if (typeof value === "string" && (RUN_MODE_IDS as readonly string[]).includes(value)) {
    return value as RunMode;
  }
  return "max";
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
