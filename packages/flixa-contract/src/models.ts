import { z } from "zod";

export const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/**
 * Usage tier 1-10: each token of the model counts as the tier's multiplier
 * (1x to 12x) toward the monthly pool.
 */
export const usageTierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
]);
export type UsageTier = z.infer<typeof usageTierSchema>;

/**
 * One model of `GET /v1/models` (alias `GET /v1/agent/models`), which returns a
 * bare JSON array of these (services/agent-api `listModelDefinitions`).
 */
export const flixaModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  /** Reasoning effort values the upstream provider supports. */
  efforts: z.array(reasoningEffortSchema),
  /** Maximum tokens in one model request. */
  contextWindow: z.number().int().positive().optional(),
  /** Maximum tokens the model can generate in one request. */
  maxOutputTokens: z.number().int().positive().optional(),
  usageTier: usageTierSchema,
  /** Overrides `usageTier` for Free accounts. */
  freeTierUsageTier: usageTierSchema.optional(),
  /** Prompts above this many tokens are billed at `longContextUsageMultiplier`. */
  longContextThreshold: z.number().int().positive().optional(),
  longContextUsageMultiplier: z.number().positive().optional(),
  /** Lowest plan that can use the model (Go unlocks the `free` models). */
  tier: z.enum(["free", "plus", "pro"]),
  /** The server's default model. */
  default: z.boolean(),
  /** Legacy flag for clients that predate usage tiers (Tier 5 and above). */
  premium: z.boolean(),
  /** Legacy: the usage tier's multiplier. */
  tokenUsageMultiplier: z.number().positive(),
});
export type FlixaModel = z.infer<typeof flixaModelSchema>;

export const modelsResponseSchema = z.array(flixaModelSchema);
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

const anthropicCapabilityFlagSchema = z.object({ supported: z.boolean() });

export const anthropicModelCapabilitiesSchema = z.object({
  batch: anthropicCapabilityFlagSchema,
  citations: anthropicCapabilityFlagSchema,
  code_execution: anthropicCapabilityFlagSchema,
  context_management: anthropicCapabilityFlagSchema.extend({
    clear_tool_uses_20250919: anthropicCapabilityFlagSchema,
    clear_thinking_20251015: anthropicCapabilityFlagSchema,
    compact_20260112: anthropicCapabilityFlagSchema,
  }),
  effort: anthropicCapabilityFlagSchema.extend({
    low: anthropicCapabilityFlagSchema,
    medium: anthropicCapabilityFlagSchema,
    high: anthropicCapabilityFlagSchema,
    xhigh: anthropicCapabilityFlagSchema.optional(),
    max: anthropicCapabilityFlagSchema,
  }),
  image_input: anthropicCapabilityFlagSchema,
  pdf_input: anthropicCapabilityFlagSchema,
  structured_outputs: anthropicCapabilityFlagSchema,
  thinking: anthropicCapabilityFlagSchema.extend({
    types: z.object({
      enabled: anthropicCapabilityFlagSchema,
      adaptive: anthropicCapabilityFlagSchema,
    }),
  }),
});
export type AnthropicModelCapabilities = z.infer<typeof anthropicModelCapabilitiesSchema>;

/** One model in the Anthropic Models API format. */
export const anthropicModelSchema = z.object({
  type: z.literal("model"),
  id: z.string(),
  display_name: z.string(),
  created_at: z.iso.datetime(),
  max_input_tokens: z.number().int().positive(),
  max_tokens: z.number().int().positive(),
  capabilities: anthropicModelCapabilitiesSchema,
});
export type AnthropicModel = z.infer<typeof anthropicModelSchema>;

/**
 * `GET /v1/models` answers in the Anthropic format instead when the request
 * carries any `anthropic-*` header (Claude Code sends `anthropic-version`).
 */
export const anthropicModelsResponseSchema = z.object({
  data: z.array(anthropicModelSchema),
  has_more: z.boolean(),
  first_id: z.string().nullable(),
  last_id: z.string().nullable(),
});
export type AnthropicModelsResponse = z.infer<typeof anthropicModelsResponseSchema>;
