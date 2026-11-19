import type { ReasoningEffort } from "./types";
import {
  getUsageTierMultiplier,
  isPremiumUsageTier,
  type UsageTier,
} from "./usage-tiers";

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
  /**
   * Usage tier (see USAGE_TIER_MULTIPLIERS): each token counts as the tier's
   * multiplier toward the quota. Tier 5 and above are premium models.
   */
  usageTier: UsageTier;
  /** Overrides usageTier for free-plan users only. */
  freeTierUsageTier?: UsageTier;
  /**
   * OpenAI 1M-context models charge more once the prompt exceeds this
   * threshold (prompt/input tokens). Applied on top of the usage tier.
   */
  longContextThreshold?: number;
  /** Multiplier applied when prompt tokens exceed longContextThreshold. */
  longContextUsageMultiplier?: number;
  tier: "free" | "plus" | "pro";
}

/** A user's plan tier: the model tiers plus Go, which unlocks only free-tier models. */
export type PlanTier = ModelDefinition["tier"] | "go";

/** Long-context surcharge for OpenAI 1M-context models (prompts > 272K tokens). */
const OPENAI_1M_LONG_CONTEXT = {
  longContextThreshold: 272_000,
  longContextUsageMultiplier: 2,
} as const;

/** GPT-6 / GPT-5.6 context and output limits. */
const OPENAI_1M_CONTEXT = {
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

const ANTHROPIC_FABLE_OPUS_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const ANTHROPIC_SONNET_5_5_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const ANTHROPIC_HAIKU_5_5_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const GOOGLE_GEMINI_3_8_FLASH_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
];
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
    xhigh?: AnthropicCapabilityFlag;
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

// Usage tiers follow the mean standard input/output price per 1M tokens:
// < $5 = Tier 1 (1x), < $10 = Tier 2 (1.5x), < $20 = Tier 3 (2x), < $40 = Tier 4 (3x),
// < $60 = Tier 5 (4x), < $80 = Tier 6 (5x), otherwise Tier 7 (6x); Tiers 8-10 (8x, 10x,
// 12x) continue the ladder. Models that used the premium quota before usage was merged
// into one pool (premium flag, or Claude Sonnet/Opus) are rated at twice their previous
// multiplier, since premium usage was worth about twice as much.
// Exception: Claude Sonnet 5.5 is Tier 2 (1.5x) on every plan.
// Rates checked 2026-09-23 against:
// https://developers.openai.com/api/docs/pricing
// https://platform.claude.com/docs/en/about-claude/pricing
// https://ai.google.dev/gemini-api/docs/pricing
// https://openrouter.ai/api/v1/models
export const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: "openai/gpt-6-astra",
    usageTier: 10,
    label: "GPT-6 Astra",
    description: "OpenAI flagship for advanced analysis, software engineering, and deep research.",
    tags: ["general", "reasoning", "agentic", "long-context"],
    efforts: OPENAI_GPT_6_EFFORTS,
    ...OPENAI_1M_CONTEXT,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "plus",
  },
  {
    id: "openai/gpt-6-sol",
    usageTier: 4,
    label: "GPT-6 Sol",
    description: "High-end GPT-6 model below Astra: strong reasoning, coding, and agentic work at lower cost.",
    tags: ["general", "reasoning", "coding", "agentic", "codex", "long-context"],
    efforts: OPENAI_GPT_5_6_EFFORTS,
    ...OPENAI_1M_CONTEXT,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "plus",
  },
  {
    id: "openai/gpt-6.1-sol",
    usageTier: 4,
    label: "GPT-6.1 Sol",
    description: "Upgrade to GPT-6 Sol for agentic coding, computer use, and document-heavy work.",
    tags: ["general", "reasoning", "coding", "agentic", "long-context"],
    efforts: OPENAI_GPT_6_EFFORTS,
    ...OPENAI_1M_CONTEXT,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "plus",
  },
  {
    id: "openai/gpt-6-luna",
    usageTier: 3,
    label: "GPT-6 Luna",
    description: "Fast, low-cost GPT-6 model for high-volume, latency-sensitive tasks.",
    tags: ["general", "reasoning", "fast", "lightweight", "codex", "long-context"],
    efforts: OPENAI_GPT_5_6_EFFORTS,
    ...OPENAI_1M_CONTEXT,
    ...OPENAI_1M_LONG_CONTEXT,
    tier: "free",
  },
  // Claude Haiku 5.5 standard rates verified 2026-10-07:
  // $0.10 / 1M input and $0.50 / 1M output for prompts up to 100K tokens
  // ($0.50 / $2.50 above 100K). Both bands stay under the $5 mean-price tier.
  // https://platform.claude.com/docs/en/models/haiku-5-5/overview
  // https://platform.claude.com/docs/en/about-claude/pricing
  {
    id: "anthropic/claude-haiku-5.5",
    usageTier: 3,
    label: "Claude Haiku 5.5",
    description: "Anthropic's fastest model for high-volume, latency-sensitive tasks such as classification, extraction, and routing.",
    tags: ["fast", "lightweight", "long-context"],
    efforts: ANTHROPIC_HAIKU_5_5_EFFORTS,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    tier: "free",
  },
  // Claude Sonnet 5.5 standard rates verified 2026-09-28:
  // $2 / 1M input tokens and $10 / 1M output tokens.
  // https://platform.claude.com/docs/en/models/sonnet-5-5/overview
  {
    id: "anthropic/claude-sonnet-5.5",
    usageTier: 2,
    label: "Claude Sonnet 5.5",
    description: "Sonnet-class model for everyday coding, agents, and knowledge work.",
    tags: ["balanced", "coding", "agentic", "long-context"],
    efforts: ANTHROPIC_SONNET_5_5_EFFORTS,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    tier: "free",
  },
  {
    id: "anthropic/claude-fable-5.1",
    usageTier: 10,
    label: "Claude Fable 5.1",
    description: "Improves on Fable 5, mainly in agentic coding, long-running workflows, and knowledge work.",
    tags: ["coding", "agentic", "long-context"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-5.5",
    usageTier: 8,
    label: "Claude Opus 5.5",
    description: "Anthropic flagship for demanding reasoning, coding, and long-horizon agentic work.",
    tags: ["powerful", "agentic"],
    efforts: ANTHROPIC_FABLE_OPUS_EFFORTS,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    tier: "plus",
  },
  {
    id: "google/gemini-3.8-flash",
    usageTier: 3,
    label: "Gemini 3.8 Flash",
    description: "Google's most intelligent Flash model, strong in software engineering and agentic tasks.",
    tags: ["fast", "coding", "agentic"],
    efforts: GOOGLE_GEMINI_3_8_FLASH_EFFORTS,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    tier: "free",
  },
  {
    id: "google/gemini-3.5-flash-lite",
    usageTier: 3,
    label: "Gemini 3.5 Flash Lite",
    description: "High-efficiency Google model for focused subagent tasks.",
    tags: ["fast"],
    efforts: GOOGLE_GEMINI_FLASH_EFFORTS,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    tier: "plus",
  },
];

export const DEFAULT_MODEL = "openai/gpt-6-luna";
/** Usage tier of models that are not registered (Tier 3, 2x). */
export const DEFAULT_USAGE_TIER: UsageTier = 3;

/** Model definitions as exposed to clients; flags the default model. */
/** Premium models: Tier 5 and above. */
export function isPremiumModelDefinition(model: ModelDefinition | undefined): boolean {
  return isPremiumUsageTier(model?.usageTier);
}

/** End of the v8 launch promotions: the last day they apply is 2026-12-01 (JST). */
const V8_LAUNCH_ENDS_AT = new Date('2026-12-02T00:00:00+09:00');

/**
 * Limited-time usage discounts on top of a model's tier, mirroring Deni AI v8's
 * `USAGE_PROMOTIONS` (packages/ai): through 2026-12-01 (JST), Claude Opus 5.5 counts
 * half (50% off) and Claude Fable 5.2 three quarters (25% off) toward the pool.
 */
export const USAGE_PROMOTIONS: ReadonlyArray<{
  id: string;
  models: readonly string[];
  /** Weight of the models' tokens while it runs: 0.5 counts them at half. */
  factor: number;
  /** First moment the promotion no longer applies. */
  endsAt: Date;
}> = [
  {
    id: 'v8-launch-claude-opus',
    models: ['anthropic/claude-opus-5.5'],
    factor: 0.5,
    endsAt: V8_LAUNCH_ENDS_AT,
  },
  {
    id: 'v8-launch-claude-fable',
    models: ['anthropic/claude-fable-5.2'],
    factor: 0.75,
    endsAt: V8_LAUNCH_ENDS_AT,
  },
];

/** The usage weight of a running promotion for a model (aliases resolved), else 1. */
export function getUsagePromotionFactor(modelId: string, now: Date = new Date()): number {
  const resolvedModelId = resolveAvailableModelId(modelId);
  const promotion = USAGE_PROMOTIONS.find(
    (entry) => entry.models.includes(resolvedModelId) && now < entry.endsAt,
  );
  return promotion?.factor ?? 1;
}

/**
 * Model definitions as exposed to clients; flags the default model. `premium`
 * and `tokenUsageMultiplier` are derived from the usage tier (with any running
 * usage promotion) and kept for clients that predate usage tiers.
 */
export function listModelDefinitions(): Array<
  ModelDefinition & { default: boolean; premium: boolean; tokenUsageMultiplier: number }
> {
  return MODEL_DEFINITIONS.map((model) => ({
    ...model,
    premium: isPremiumModelDefinition(model),
    tokenUsageMultiplier:
      getUsageTierMultiplier(model.usageTier) * getUsagePromotionFactor(model.id),
    default: model.id === DEFAULT_MODEL,
  }));
}

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
  ["claude-sonnet-5-5", "anthropic/claude-sonnet-5.5"],
  ["anthropic/claude-sonnet-5-5", "anthropic/claude-sonnet-5.5"],
  ["claude-haiku-5-5", "anthropic/claude-haiku-5.5"],
  ["anthropic/claude-haiku-5-5", "anthropic/claude-haiku-5.5"],
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

const ANTHROPIC_SONNET_5_5_CAPABILITIES: AnthropicCapabilities = {
  ...ANTHROPIC_FULL_CAPABILITIES,
  effort: {
    ...ANTHROPIC_FULL_CAPABILITIES.effort,
    xhigh: { supported: true },
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
    id: "claude-sonnet-5-5",
    display_name: "Claude Sonnet 5.5",
    created_at: "2026-09-28T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: ANTHROPIC_SONNET_5_5_CAPABILITIES,
  },
  {
    type: "model",
    id: "claude-haiku-5-5",
    display_name: "Claude Haiku 5.5",
    created_at: "2026-10-07T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: ANTHROPIC_SONNET_5_5_CAPABILITIES,
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
 * Base per-model usage multiplier, with any running usage promotion (ignores
 * long-context surcharge).
 */
export function getModelTokenUsageMultiplier(
  modelId: string,
  tier?: PlanTier,
  now: Date = new Date(),
): number {
  const definition = getModelDefinition(modelId);
  const usageTier =
    (tier === "free" ? definition?.freeTierUsageTier : undefined) ??
    definition?.usageTier ??
    DEFAULT_USAGE_TIER;
  return getUsageTierMultiplier(usageTier) * getUsagePromotionFactor(modelId, now);
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
  tier?: PlanTier,
): number {
  const base = getModelTokenUsageMultiplier(modelId, tier);
  if (usage === undefined) {
    return base;
  }
  return base * getLongContextUsageMultiplier(modelId, usage);
}
