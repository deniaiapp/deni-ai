import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import type { ClientResult } from './types';

// OpenRouter SDK client
export const openrouterClient = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || '',
  httpReferer: "https://flixa.deniai.app",
  appTitle: "Deni AI Flixa"
});

// Voids.top (OpenAI compatible) client
export const voidsClient = new OpenAI({
  baseURL: process.env.OPENAI_COMPAT_BASE_URL || 'https://capi.voids.top/v2',
  apiKey: process.env.OPENAI_COMPAT_API_KEY || 'a',
});

export function isAnthropicModel(model: string): boolean {
  const normalizedModel = model.toLowerCase();
  return normalizedModel.startsWith('anthropic/') || normalizedModel.includes('claude');
}

export function getClient(model: string): ClientResult {
  // Models with a slash (e.g. "anthropic/claude-3.5-sonnet") go through OpenRouter
  const useOpenRouter = model.includes('/');

  if (useOpenRouter) {
    if (!process.env.OPENROUTER_API_KEY) {

      return { error: 'OPENROUTER_API_KEY is required for OpenRouter models' };
    }
    return { type: 'openrouter', client: openrouterClient, providerName: 'openrouter' };
  }

  return { type: 'openai', client: voidsClient, providerName: 'voids.top' };
}
