import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import type { ClientResult } from './types';

// OpenRouter SDK client
export const openrouterClient = new OpenRouter({
  apiKey: Bun.env.OPENROUTER_API_KEY || '',
  httpReferer: "https://flixa.deniai.app",
  xTitle: "Deni AI Flixa"
});

// Voids.top (OpenAI compatible) client
export const voidsClient = new OpenAI({
  baseURL: Bun.env.OPENAI_COMPAT_BASE_URL || 'https://capi.voids.top/v2',
  apiKey: Bun.env.OPENAI_COMPAT_API_KEY || 'a',
});

export function getClient(model: string): ClientResult {
  const useOpenRouter = model.includes('/');

  if (useOpenRouter) {
    if (!Bun.env.OPENROUTER_API_KEY) {
      return { error: 'OPENROUTER_API_KEY is required for OpenRouter models' };
    }
    return { type: 'openrouter', client: openrouterClient, providerName: 'openrouter' };
  }

  return { type: 'openai', client: voidsClient, providerName: 'voids.top' };
}
