export interface ModelDefinition {
  id: string;
  label: string;
  description: string;
  tags: string[];
  premium?: boolean;
  tokenUsageMultiplier?: number;
  tier: "free" | "plus" | "pro" | "max";
}

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
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    description: "Flagship model: top reasoning, code, long-context tasks.",
    tags: ["general", "reasoning", "fast"],
    tokenUsageMultiplier: 1.75,
    tier: "free",
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    description:
      "Flagship model: top reasoning, code tasks. low-cost than GPT-5.5.",
    tags: ["general", "reasoning", "fast"],
    tokenUsageMultiplier: 1.5,
    tier: "free",
  },
  {
    id: "openai/gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Advanced agentic coding for complex engineering & security.",
    tags: ["coding", "agentic", "fast"],
    tier: "free",
  },
  {
    id: "openai/gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    description: "Advanced agentic coding for complex engineering & security.",
    tags: ["coding", "agentic", "fast"],
    tier: "free",
  },
  {
    id: "openai/gpt-5.2",
    label: "GPT-5.2",
    description: "Flagship model: top reasoning, code, long-context tasks.",
    tags: ["general", "reasoning"],
    tier: "free",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    description: "Fastest model with Sonnet-level coding at low cost.",
    tags: ["fast", "lightweight"],
    tier: "free",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    description: "Latest balanced model with frontier performance.",
    tags: ["balanced", "latest"],
    tier: "plus",
  },
  {
    id: "anthropic/claude-fable-5",
    label: "Claude Fable 5",
    description: "Mythos-class model from Anthropic.",
    tags: ["powerful", "agentic"],
    premium: true,
    tokenUsageMultiplier: 5,
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-4.8",
    label: "Claude Opus 4.8",
    description: "Most capable: hybrid reasoning & long-horizon tasks.",
    tags: ["powerful", "agentic"],
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "pro",
  },
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    description: "Most capable: hybrid reasoning & long-horizon tasks.",
    tags: ["powerful", "agentic"],
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "pro",
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Legacy Claude Opus model.",
    tags: ["powerful", "agentic"],
    premium: true,
    tokenUsageMultiplier: 3,
    tier: "plus",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    description: "Balanced flagship: best coding, agents & reasoning.",
    tags: ["balanced", "coding"],
    tier: "plus",
  },
  {
    id: "glm-4.6",
    label: "GLM-4.6",
    description: "200K context, strong coding & reasoning.",
    tags: ["general", "long-context"],
    tier: "free",
  },
  {
    id: "grok-code-fast-1",
    label: "Grok Code Fast 1",
    description: "Fast, accurate code generation & debugging.",
    tags: ["coding", "fast"],
    tier: "free",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    description:
      "Google frontier model: agentic coding, 1M context, multimodal.",
    tags: ["powerful", "preview"],
    tokenUsageMultiplier: 1.5,
    tier: "free",
  },
  {
    id: "google/gemini-3-pro-preview",
    label: "Gemini 3 Pro Preview",
    description: "Cutting-edge preview: advanced reasoning & agents.",
    tags: ["powerful", "preview"],
    tokenUsageMultiplier: 1.5,
    premium: true,
    tier: "free",
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Ultra-fast multimodal model with strong reasoning.",
    tags: ["fast"],
    tier: "free",
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    description: "Ultra-fast multimodal preview with strong reasoning.",
    tags: ["fast", "preview"],
    tier: "free",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    description: "Ultra-fast model for fast tasks.",
    tags: ["fast"],
    tier: "free",
  },
];

export const DEFAULT_MODEL = "openai/gpt-5.5";
export const AVAILABLE_MODELS = MODEL_DEFINITIONS.map((model) => model.id);
export const DEFAULT_TOKEN_USAGE_MULTIPLIER = 1;

function stripModelProvider(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

export function resolveAvailableModelId(modelId: string): string {
  if (!modelId) {
    return modelId;
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

export const ANTHROPIC_MODEL_DEFINITIONS: AnthropicModelDefinition[] = [
  {
    type: "model",
    id: "claude-sonnet-4.6",
    display_name: "Claude Sonnet 4.6",
    created_at: "2026-02-17T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: {
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
    },
  },
  {
    type: "model",
    id: "claude-opus-4.6",
    display_name: "Claude Opus 4.6",
    created_at: "2026-02-04T00:00:00Z",
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: {
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
    },
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

export function getModelTokenUsageMultiplier(modelId: string): number {
  const multiplier =
    getModelDefinition(modelId)?.tokenUsageMultiplier ??
    DEFAULT_TOKEN_USAGE_MULTIPLIER;

  return Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : DEFAULT_TOKEN_USAGE_MULTIPLIER;
}

export function getModelTierRequirement(
  model: string,
): "free" | "plus" | "pro" | "max" {
  const resolvedModel = resolveAvailableModelId(model);
  const def = MODEL_DEFINITIONS.find((m) => m.id === resolvedModel);
  return def ? def.tier : "free";
}
