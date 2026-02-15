import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
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

// Anthropic SDK client (for direct Claude API access)
export const anthropicClient = new Anthropic({
  apiKey: Bun.env.ANTHROPIC_API_KEY || '',
});

// Models that should be routed directly to Anthropic API
const ANTHROPIC_DIRECT_MODELS = /^claude-/i;

export function getClient(model: string): ClientResult {
  // Route claude-* models directly to Anthropic when API key is available
  if (ANTHROPIC_DIRECT_MODELS.test(model) && Bun.env.ANTHROPIC_API_KEY) {
    return { type: 'anthropic', client: anthropicClient, providerName: 'anthropic' };
  }

  // Models with a slash (e.g. "anthropic/claude-3.5-sonnet") go through OpenRouter
  const useOpenRouter = model.includes('/');

  if (useOpenRouter) {
    if (!Bun.env.OPENROUTER_API_KEY) {

      return { error: 'OPENROUTER_API_KEY is required for OpenRouter models' };
    }
    return { type: 'openrouter', client: openrouterClient, providerName: 'openrouter' };
  }

  return { type: 'openai', client: voidsClient, providerName: 'voids.top' };
}
