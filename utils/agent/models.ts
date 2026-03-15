export interface ModelDefinition {
  id: string;
  label: string;
  description: string;
  tags: string[];
  premium?: boolean;
  tier: "free" | "plus" | "pro";
}

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    description: "Flagship model: top reasoning, code, long-context tasks.",
    tags: ["general", "reasoning", "fast"],
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
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    description: "Balanced flagship: best coding, agents & reasoning.",
    tags: ["balanced", "coding"],
    tier: "plus",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    description: "Latest balanced model with frontier performance.",
    tags: ["balanced", "latest"],
    tier: "plus",
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Most capable: hybrid reasoning & long-horizon tasks.",
    tags: ["powerful", "agentic"],
    premium: true,
    tier: "pro",
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
    premium: true,
    tier: "free",
  },
  {
    id: "google/gemini-3-pro-preview",
    label: "Gemini 3 Pro Preview",
    description: "Cutting-edge preview: advanced reasoning & agents.",
    tags: ["powerful", "preview"],
    premium: true,
    tier: "free",
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    description: "Ultra-fast multimodal preview with strong reasoning.",
    tags: ["fast", "preview"],
    tier: "free",
  },
];

export const DEFAULT_MODEL = "openai/gpt-5.4";
export const AVAILABLE_MODELS = MODEL_DEFINITIONS.map((model) => model.id);

export function getModelLabel(modelId: string): string {
  const def = MODEL_DEFINITIONS.find((m) => m.id === modelId);
  return def ? def.label : modelId;
}

export function getModelDefinition(
  modelId: string,
): ModelDefinition | undefined {
  return MODEL_DEFINITIONS.find((m) => m.id === modelId);
}

export function getModelTierRequirement(
  model: string,
): "free" | "plus" | "pro" {
  const def = MODEL_DEFINITIONS.find((m) => m.id === model);
  return def ? def.tier : "free";
}
