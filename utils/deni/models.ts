export type ModelCategory = 'basic' | 'premium';

// Premium model patterns (high-end models)
const PREMIUM_PATTERNS = [
  // Claude models
  /claude-.*-opus/i,
  /claude-.*-sonnet/i,
  // GPT-4 family
  /gpt-4o(?!-mini)/i,
  /gpt-4-turbo/i,
  /gpt-4(?!-mini)/i,
  /o1-preview/i,
  /o1-mini/i,
  /o3/i,
  // Gemini Pro/Ultra
  /gemini.*pro/i,
  /gemini.*ultra/i,
  /gemini-2/i,
  // DeepSeek high-end
  /deepseek-r1(?!-distill)/i,
  /deepseek-v3/i,
  // Llama 3.1/3.2/3.3 405B
  /llama.*405b/i,
  // Qwen high-end
  /qwen.*72b/i,
  /qwen.*110b/i,
  // Mistral Large
  /mistral.*large/i,
];

/**
 * Determine if a model is premium or basic category
 */
export function getModelCategory(model: string): ModelCategory {
  const modelLower = model.toLowerCase();

  for (const pattern of PREMIUM_PATTERNS) {
    if (pattern.test(modelLower)) {
      return 'premium';
    }
  }

  return 'basic';
}

/**
 * Check if user has enough quota for the model category
 */
export function hasQuotaForModel(
  usage: Array<{ category: 'basic' | 'premium'; remaining: number | null }>,
  modelCategory: ModelCategory
): { allowed: boolean; remaining: number | null } {
  const categoryUsage = usage.find((u) => u.category === modelCategory);

  if (!categoryUsage) {
    return { allowed: true, remaining: null };
  }

  const remaining = categoryUsage.remaining;
  if (remaining === null) {
    return { allowed: true, remaining: null };
  }

  return { allowed: remaining > 0, remaining };
}
