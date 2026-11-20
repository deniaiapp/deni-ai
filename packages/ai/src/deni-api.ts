import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";

/**
 * The Deni AI API (OpenAI-compatible, `https://api.deniai.app/v1`): the one upstream of every
 * model Deni AI calls. Model ids there are author-prefixed (`anthropic/claude-haiku-5.5`).
 */

export const DENI_API_DEFAULT_BASE_URL = "https://api.deniai.app/v1";

/**
 * The model of background work that needs no particular model: chat titles, memory
 * extraction, ad review, Run's summaries.
 */
export const DENI_API_UTILITY_MODEL_ID = "anthropic/claude-haiku-5.5";

export type DeniApiSettings = {
  apiKey: string;
  baseURL?: string | null;
  /**
   * Fields merged into every JSON request body. The Deni AI API passes fields it does not
   * know on to the model's provider (prompt caching, thinking controls).
   */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
};

function withExtraBody(extraBody: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return fetch(input, init);
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return fetch(input, init);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fetch(input, init);
    return fetch(input, { ...init, body: JSON.stringify({ ...body, ...extraBody }) });
  };
}

export function createDeniApi({
  apiKey,
  baseURL,
  extraBody,
  headers,
}: DeniApiSettings): OpenAIProvider {
  return createOpenAI({
    apiKey,
    baseURL: baseURL || DENI_API_DEFAULT_BASE_URL,
    headers,
    ...(extraBody && Object.keys(extraBody).length > 0 ? { fetch: withExtraBody(extraBody) } : {}),
  });
}
