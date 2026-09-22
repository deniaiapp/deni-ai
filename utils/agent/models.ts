import type { ReasoningEffort } from "./types";

export interface ModelDefinition {
  id: string;
  label: string;
  description: string;
  tags: string[];
  /** Reasoning effort values supported by the upstream provider. */
  efforts: ReasoningEffort[];
  /** Maximum number of tokens available in one model request. */
  contextWindow?: number;
  /** Maximum number of tokens the model can generate in one request. */
  maxOutputTokens?: number;
  premium?: boolean;
  tokenUsageMultiplier?: number;
  /**
   * OpenAI 1M-context models charge more once the prompt exceeds this
   * threshold (prompt/input tokens). Applied on top of tokenUsageMultiplier.
   */
  longContextThreshold?: number;
  /** Multiplier applied when prompt tokens exceed longContextThreshold. */
  longContextUsageMultiplier?: number;
  tier: "free" | "plus" | "pro" | "max";
}

/** Default long-context surcharge for OpenAI 1M-context models. */
const OPENAI_1M_LONG_CONTEXT = {
  longContextThreshold: 200_000,
  longContextUsageMultiplier: 2,
} as const;

/** Current GPT-5.6 context/output limits from the OpenAI model catalog. */
const GPT_5_6_CONTEXT = {
  contextWindow: 1_050_000,
  maxOutputTokens: 128_000,
} as const;

const OPENAI_GPT_6_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const OPENAI_GPT_5_6_EFFORTS: ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const OPENAI_GPT_5_EFFORTS: ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];
const OPENAI_CODEX_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];

const ANTHROPIC_FABLE_OPUS_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const ANTHROPIC_STANDARD_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "max",
];
const ANTHROPIC_NO_EFFORTS: ReasoningEffort[] = [];

const GOOGLE_GEMINI_PRO_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
];
const GOOGLE_GEMINI_PRO_PREVIEW_EFFORTS: ReasoningEffort[] = ["low", "high"];
const GOOGLE_GEMINI_FLASH_EFFORTS: ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
];

interface AnthropicCapabilityFlag {
  supported: boolean;
}

interface AnthropicCapabilities {
  batch: AnthropicCapabilityFlag;
  citations: AnthropicCapabilityFlag;
  code_execution: AnthropicCapabilityFlag;
  context_management: AnthropicCapabilityFlag & {
    clear_tool_uses_20250919: AnthropicCapabilityFlag;
    clear_thinking_20251015: AnthropicCapabilityFlag;
    compact_20260112: AnthropicCapabilityFlag;
  };
  effort: AnthropicCapabilityFlag & {
    low: AnthropicCapabilityFlag;
    medium: AnthropicCapabilityFlag;
    high: AnthropicCapabilityFlag;
    max: AnthropicCapabilityFlag;
  };
  image_input: AnthropicCapabilityFlag;
  pdf_input: AnthropicCapabilityFlag;
  structured_outputs: AnthropicCapabilityFlag;
  thinking: AnthropicCapabilityFlag & {
    types: {
      enabled: AnthropicCapabilityFlag;
      adaptive: AnthropicCapabilityFlag;
    };
  };
}

export interface AnthropicModelDefinition {
  type: "model";
  id: string;
  display_name: string;
  created_at: string;
  max_input_tokens: number;
  max_tokens: number;
  capabilities: AnthropicCapabilities;
}

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: "openai/gpt-6-astra",
    label: "GPT-6 Astra",
    description:
      "GPT-6 frontier model for advanced reasoning, coding, and agentic work.",
    tags: ["general", "reasoning", "agentic"],
    efforts: OPENAI_GPT_6_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 5,
    tier: "plus",
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description:
      "GPT-5.6 flagship: frontier reasoning, coding, agentic & long-context work.",
    tags: ["general", "reasoning", "agentic", "codex", "long-context"],
    efforts: OPENAI_GPT_5_6_EFFORTS,
    ...GPT_5_6_CONTEXT,
    tokenUsageMultiplier: 2,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "free",
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description:
      "GPT-5.6 balanced tier: GPT-5.5-competitive performance at lower cost.",
    tags: ["general", "reasoning", "balanced", "codex", "long-context"],
    efforts: OPENAI_GPT_5_6_EFFORTS,
    ...GPT_5_6_CONTEXT,
    tokenUsageMultiplier: 1.5,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "free",
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description:
      "GPT-5.6 fast & affordable tier for high-volume and lighter tasks.",
    tags: ["fast", "lightweight", "codex", "long-context"],
    efforts: OPENAI_GPT_5_6_EFFORTS,
    ...GPT_5_6_CONTEXT,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "free",
  },
  {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    description: "Flagship model: top reasoning, code, long-context tasks.",
    tags: ["general", "reasoning", "fast", "long-context"],
    efforts: OPENAI_GPT_5_EFFORTS,
    tokenUsageMultiplier: 2,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "free",
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    description:
      "Flagship model: top reasoning, code tasks. low-cost than GPT-5.5.",
    tags: ["general", "reasoning", "fast", "long-context"],
    efforts: OPENAI_GPT_5_EFFORTS,
    tokenUsageMultiplier: 1.5,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "free",
  },
  {
    id: "openai/gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Advanced agentic coding for complex engineering & security.",
    tags: ["coding", "agentic", "fast"],
    efforts: OPENAI_CODEX_EFFORTS,
    tier: "free",
  },
  {
    id: "openai/gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    description: "Advanced agentic coding for complex engineering & security.",
    tags: ["coding", "agentic", "fast"],
    efforts: OPENAI_CODEX_EFFORTS,
    tier: "free",
  },
  {
    id: "openai/gpt-5.2",
    label: "GPT-5.2",
    description: "Flagship model: top reasoning, code, long-context tasks.",
    tags: ["general", "reasoning"],
    efforts: OPENAI_GPT_5_EFFORTS,
    tier: "free",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    description: "Fastest model with Sonnet-level coding at low cost.",
    tags: ["fast", "lightweight"],
    efforts: ANTHROPIC_NO_EFFORTS,
    tier: "free",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    description: "Latest balanced model with frontier performance.",
    tags: ["balanced", "latest"],
    efforts: ANTHROPIC_STANDARD_EFFORTS,
    tier: "plus",
  },
  {
    id: "anthropic/claude-fable-5.1",
    label: "Claude Fable 5.1",
    description: "The world's most advanced model for coding, knowledge work, and long-running problem solving.",
    tags: ["coding", "agentic", "long-context"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 5,
    tier: "plus",
  },
  {
    id: "anthropic/claude-fable-5",
    label: "Claude Fable 5",
    description:
      "Mythos-class model from Anthropic: frontier intelligence for long-horizon coding & knowledge work.",
    tags: ["powerful", "agentic", "long-context"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 5,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-5.5",
    label: "Claude Opus 5.5",
    description: "Claude Opus 5.5 for reasoning, coding, and agentic tasks.",
    tags: ["powerful", "agentic"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    description: "Hybrid reasoning & long-horizon tasks.",
    tags: ["powerful", "agentic"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-4.8",
    label: "Claude Opus 4.8",
    description: "Most capable: hybrid reasoning & long-horizon tasks.",
    tags: ["powerful", "agentic"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    description: "Most capable: hybrid reasoning & long-horizon tasks.",
    tags: ["powerful", "agentic"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Legacy Claude Opus model.",
    tags: ["powerful", "agentic"],
    efforts: ANTHROPIC_STANDARD_EFFORTS,
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "plus",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    description: "Balanced flagship: best coding, agents & reasoning.",
    tags: ["balanced", "coding"],
    efforts: ANTHROPIC_NO_EFFORTS,
    tier: "plus",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    description:
      "Google frontier model: agentic coding, 1M context, multimodal.",
    tags: ["powerful", "preview"],
    efforts: GOOGLE_GEMINI_PRO_EFFORTS,
    tokenUsageMultiplier: 1.5,
    tier: "free",
  },
  {
    id: "google/gemini-3-pro-preview",
    label: "Gemini 3 Pro Preview",
    description: "Cutting-edge preview: advanced reasoning & agents.",
    tags: ["powerful", "preview"],
    efforts: GOOGLE_GEMINI_PRO_PREVIEW_EFFORTS,
    tokenUsageMultiplier: 1.5,
    premium: true,
    tier: "free",
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Ultra-fast multimodal model with strong reasoning.",
    tags: ["fast"],
    efforts: GOOGLE_GEMINI_FLASH_EFFORTS,
    tier: "free",
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    description: "Ultra-fast multimodal preview with strong reasoning.",
    tags: ["fast", "preview"],
    efforts: GOOGLE_GEMINI_FLASH_EFFORTS,
    tier: "free",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    description: "Ultra-fast model for fast tasks.",
    tags: ["fast"],
    efforts: GOOGLE_GEMINI_FLASH_EFFORTS,
    tier: "free",
  },
];

export const DEFAULT_MODEL = "openai/gpt-5.5";
export const AVAILABLE_MODELS = MODEL_DEFINITIONS.map((model) => model.id);
export const DEFAULT_TOKEN_USAGE_MULTIPLIER = 1;

/**
 * OpenAI's unsuffixed `gpt-5.6` alias is the Sol tier. Resolve it before the
 * provider check so Codex requests get the registered 1M-context metadata and
 * the OpenRouter model id remains deterministic.
 */
const MODEL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["gpt-5.6", "openai/gpt-5.6-sol"],
  ["openai/gpt-5.6", "openai/gpt-5.6-sol"],
  ["claude-opus-5-5", "anthropic/claude-opus-5.5"],
  ["anthropic/claude-opus-5-5", "anthropic/claude-opus-5.5"],
]);

function stripModelProvider(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

export function resolveAvailableModelId(modelId: string): string {
  if (!modelId) {
    return modelId;
  }

  const alias = MODEL_ALIASES.get(modelId.toLowerCase());
  if (alias) {
    return alias;
  }

  const exactMatch = MODEL_DEFINITIONS.find((model) => model.id === modelId);
  if (exactMatch) {
    return exactMatch.id;
  }

  if (modelId.includes("/")) {
    return modelId;
  }

  const matchedModels = MODEL_DEFINITIONS.filter(
    (model) => stripModelProvider(model.id) === modelId,
  );

  if (matchedModels.length === 1) {
    return matchedModels[0].id;
  }

  if (modelId.toLowerCase().includes("gpt")) {
    return `openai/${modelId}`;
  }

  return modelId;
}

const ANTHROPIC_FULL_CAPABILITIES: AnthropicCapabilities = {
  batch: { supported: true },
  citations: { supported: true },
  code_execution: { supported: true },
  context_management: {
    supported: true,
    clear_tool_uses_20250919: { supported: true },
    clear_thinking_20251015: { supported: true },
    compact_20260112: { supported: true },
  },
  effort: {
    supported: true,
    low: { supported: true },
    medium: { supported: true },
    high: { supported: true },
    max: { supported: true },
  },
  image_input: { supported: true },
  pdf_input: { supported: true },
  structured_outputs: { supported: true },
  thinking: {
    supported: true,
    types: {
      enabled: { supported: true },
      adaptive: { supported: true },
    },
  },
};

export const ANTHROPIC_MODEL_DEFINITIONS: AnthropicModelDefinition[] = [
  {
    type: "model",
    id: "claude-fable-5",
    display_name: "Claude Fable 5",
    created_at: "2026-06-09T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: ANTHROPIC_FULL_CAPABILITIES,
  },
  {
    type: "model",
    id: "claude-sonnet-4.6",
    display_name: "Claude Sonnet 4.6",
    created_at: "2026-02-17T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: ANTHROPIC_FULL_CAPABILITIES,
  },
  {
    type: "model",
    id: "claude-opus-4.6",
    display_name: "Claude Opus 4.6",
    created_at: "2026-02-04T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: ANTHROPIC_FULL_CAPABILITIES,
  },
  {
    type: "model",
    id: "claude-haiku-4.5",
    display_name: "Claude Haiku 4.5",
    created_at: "2025-10-15T00:00:00Z",
    max_input_tokens: 200000,
    max_tokens: 64000,
    capabilities: {
      batch: { supported: true },
      citations: { supported: true },
      code_execution: { supported: false },
      context_management: {
        supported: true,
        clear_tool_uses_20250919: { supported: true },
        clear_thinking_20251015: { supported: true },
        compact_20260112: { supported: false },
      },
      effort: {
        supported: false,
        low: { supported: false },
        medium: { supported: false },
        high: { supported: false },
        max: { supported: false },
      },
      image_input: { supported: true },
      pdf_input: { supported: true },
      structured_outputs: { supported: true },
      thinking: {
        supported: true,
        types: {
          enabled: { supported: true },
          adaptive: { supported: false },
        },
      },
    },
  },
];

export function getModelLabel(modelId: string): string {
  const resolvedModelId = resolveAvailableModelId(modelId);
  const def = MODEL_DEFINITIONS.find((m) => m.id === resolvedModelId);
  return def ? def.label : modelId;
}

export function getModelDefinition(
  modelId: string,
): ModelDefinition | undefined {
  const resolvedModelId = resolveAvailableModelId(modelId);
  return MODEL_DEFINITIONS.find((m) => m.id === resolvedModelId);
}

export function getModelContextWindow(modelId: string): number | undefined {
  return getModelDefinition(modelId)?.contextWindow;
}

function numField(
  record: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Prompt/context size for long-context threshold checks.
 * - OpenAI-style: `prompt_tokens` already includes cached tokens.
 * - Anthropic-style: `input_tokens` excludes cache tokens; add them back.
 */
function getPromptTokenCount(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const cacheRead = numField(
    record,
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  );
  const cacheWrite = numField(
    record,
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  );

  // Prefer OpenAI prompt_tokens when present (includes cached subset).
  const openaiPrompt = numField(record, "prompt_tokens", "promptTokens");
  if (openaiPrompt !== null) {
    return openaiPrompt;
  }

  const inputTokens = numField(record, "input_tokens", "inputTokens");
  if (inputTokens === null && cacheRead === null && cacheWrite === null) {
    return null;
  }

  // Anthropic-style: sum input + cache tokens for total context size.
  return (inputTokens ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
}

/**
 * Base per-model usage multiplier (ignores long-context surcharge).
 */
export function getModelTokenUsageMultiplier(modelId: string): number {
  const multiplier =
    getModelDefinition(modelId)?.tokenUsageMultiplier ??
    DEFAULT_TOKEN_USAGE_MULTIPLIER;

  return Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : DEFAULT_TOKEN_USAGE_MULTIPLIER;
}

/**
 * Long-context surcharge for OpenAI 1M models (and any model that defines
 * longContextThreshold / longContextUsageMultiplier).
 * Returns 1 when the prompt is within the short-context band or the model
 * has no long-context pricing.
 */
export function getLongContextUsageMultiplier(
  modelId: string,
  usage: unknown,
): number {
  const def = getModelDefinition(modelId);
  const threshold = def?.longContextThreshold;
  const longMultiplier = def?.longContextUsageMultiplier;

  if (
    threshold === undefined ||
    longMultiplier === undefined ||
    !Number.isFinite(threshold) ||
    !Number.isFinite(longMultiplier) ||
    longMultiplier <= 0
  ) {
    return 1;
  }

  const promptTokens = getPromptTokenCount(usage);
  if (promptTokens === null || promptTokens <= threshold) {
    return 1;
  }

  return longMultiplier;
}

/**
 * Combined multiplier: base model rate × long-context surcharge (if any).
 */
export function getEffectiveTokenUsageMultiplier(
  modelId: string,
  usage?: unknown,
): number {
  const base = getModelTokenUsageMultiplier(modelId);
  if (usage === undefined) {
    return base;
  }
  return base * getLongContextUsageMultiplier(modelId, usage);
}

export function getModelTierRequirement(
  model: string,
): "free" | "plus" | "pro" | "max" {
  const resolvedModel = resolveAvailableModelId(model);
  const def = MODEL_DEFINITIONS.find((m) => m.id === resolvedModel);
  return def ? def.tier : "free";
}
