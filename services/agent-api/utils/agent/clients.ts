import OpenAI from 'openai';
import type { ClientResult } from './types';

// Voids.top (OpenAI compatible) client
export const voidsClient = new OpenAI({
  baseURL: process.env.OPENAI_COMPAT_BASE_URL || 'https://capi.voids.top/v2',
  apiKey: process.env.OPENAI_COMPAT_API_KEY || 'a',
});

// Deni AI API (OpenAI compatible) client for every catalog model. Created on first
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

/**
 * True for a model the Deni AI API serves from OpenRouter (every `author/model` id that is
 * not OpenAI's). The Deni AI API passes request fields it does not know on to its upstream,
 * so the OpenRouter server-tool policy still applies to these models.
 */
export function isOpenRouterRoutedModel(model: string): boolean {
  return !isOpenAIModel(model) && model.includes('/');
}

/** True when getClient routes the model to the Deni AI API (every `author/model` id). */
export function isDeniRoutedModel(model: string): boolean {
  return model.includes('/');
}

/** The Deni AI API base URL and key, for requests made without the SDK client. */
export function getDeniApiTarget(): { baseUrl: string; apiKey: string } | null {
  const apiKey = process.env.DENI_AI_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.DENI_AI_API_BASE_URL || 'https://api.deniai.app/v1').replace(/\/$/, ''),
    apiKey,
  };
}

export function getClient(model: string): ClientResult {
  // Every catalog model (e.g. "openai/gpt-6-luna", "anthropic/claude-sonnet-5.5",
  // "google/gemini-3.8-flash") goes through the Deni AI API, forwarded as it is.
  if (isDeniRoutedModel(model)) {
    const apiKey = process.env.DENI_AI_API_KEY;
    if (!apiKey) {
      return { error: 'DENI_AI_API_KEY is required' };
    }
    return { type: 'deni', client: getDeniClient(apiKey), providerName: 'deni-ai' };
  }

  return { type: 'openai', client: voidsClient, providerName: 'voids.top' };
}
