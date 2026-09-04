export const DENI_MODEL_ID = "openai/gpt-5.6-luna";
export const DENI_REASONING_EFFORT = "max";
export const DENI_MODEL_LABEL = "GPT-5.6 Luna · max";

export const RUN_MODE_IDS = ["default", "high", "xhigh", "max"] as const;
export type RunMode = (typeof RUN_MODE_IDS)[number];
export type ReasoningEffort = "medium" | "high" | "xhigh" | "max";

export const RUN_MODES: Record<
  RunMode,
  {
    id: RunMode;
    label: string;
    effort: ReasoningEffort;
    tokenMultiplier: number;
    hint: string;
  }
> = {
  default: {
    id: "default",
    label: "Run Default",
    effort: "medium",
    tokenMultiplier: 0.5,
    hint: "Luna medium · 0.5× tokens",
  },
  high: {
    id: "high",
    label: "Run High",
    effort: "high",
    tokenMultiplier: 0.8,
    hint: "Luna high · 0.8× tokens",
  },
  xhigh: {
    id: "xhigh",
    label: "Run xhigh",
    effort: "xhigh",
    tokenMultiplier: 0.9,
    hint: "Luna xhigh · 0.9× tokens",
  },
  max: {
    id: "max",
    label: "Run Max",
    effort: "max",
    tokenMultiplier: 1,
    hint: "Luna max",
  },
};

export function parseRunMode(value: unknown): RunMode {
  if (typeof value === "string" && (RUN_MODE_IDS as readonly string[]).includes(value)) {
    return value as RunMode;
  }
  return "max";
}
