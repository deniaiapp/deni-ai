import OpenAI from 'openai';
import type { ClientResult } from './types';

// Voids.top (OpenAI compatible) client
export const voidsClient = new OpenAI({
  baseURL: process.env.OPENAI_COMPAT_BASE_URL || 'https://capi.voids.top/v2',
  apiKey: process.env.OPENAI_COMPAT_API_KEY || 'a',
});

// Deni AI API (OpenAI compatible) client for OpenAI models. Created on first
// use so a missing key becomes a request error instead of an import failure.
let deniClient: OpenAI | undefined;

function getDeniClient(apiKey: string): OpenAI {
  deniClient ??= new OpenAI({
    baseURL: process.env.DENI_AI_API_BASE_URL || 'https://api.deniai.app/v1',
    apiKey,
    // Deni AI API already retries its upstream on 429/5xx.
    maxRetries: 0,
  });
  return deniClient;
}

export function isAnthropicModel(model: string): boolean {
  const normalizedModel = model.toLowerCase();
  return normalizedModel.startsWith('anthropic/') || normalizedModel.includes('claude');
}

export function isOpenAIModel(model: string): boolean {
  return model.toLowerCase().startsWith('openai/');
}

/** True when getClient routes the model to OpenRouter (shared OPENROUTER_API_KEY). */
export function isOpenRouterRoutedModel(model: string): boolean {
  return !isOpenAIModel(model) && model.includes('/');
}

export function getClient(model: string): ClientResult {
  // OpenAI models (e.g. "openai/gpt-6-luna") go through Deni AI API
  if (isOpenAIModel(model)) {
    const apiKey = process.env.DENI_AI_API_KEY;
    if (!apiKey) {
      return { error: 'DENI_AI_API_KEY is required for OpenAI models' };
    }
    return { type: 'deni', client: getDeniClient(apiKey), providerName: 'deni-ai' };
  }

  // Other models with a slash (e.g. "anthropic/claude-3.5-sonnet") go through OpenRouter
  if (isOpenRouterRoutedModel(model)) {
    if (!process.env.OPENROUTER_API_KEY) {
      return { error: 'OPENROUTER_API_KEY is required for OpenRouter models' };
    }
    // OpenRouter is called with fetch directly, so no SDK client is needed.
    return { type: 'openrouter', providerName: 'openrouter' };
  }

  return { type: 'openai', client: voidsClient, providerName: 'voids.top' };
}
