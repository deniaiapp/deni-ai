import type { LanguageModel, streamText } from "ai";
import { createDeniApi } from "./deni-api";
import type { ModelDefinition, ReasoningEffort } from "./models";

/**
 * How a catalog model is called, shared by Deni AI chat and Deni Run: every model goes
 * through the Deni AI API, under its author-prefixed id, with its reasoning effort and the
 * request options of its author. The key is passed in by the caller; plan access and usage
 * checks stay with the caller too.
 */

const openaiEffortOptions = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type CatalogProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

export type CatalogProviderKeys = {
  deniApiKey?: string | null;
  deniApiBaseUrl?: string | null;
};

/** The Deni AI API key is missing. */
export class CatalogProviderUnavailableError extends Error {
  readonly code = "provider_unavailable";
  constructor() {
    super("Deni AI API is not configured in the current environment.");
    this.name = "CatalogProviderUnavailableError";
  }
}

export function isCatalogProviderUnavailableError(
  error: unknown,
): error is CatalogProviderUnavailableError {
  return (error as { code?: unknown } | null)?.code === "provider_unavailable";
}

export function getCatalogModelProviderId(model: ModelDefinition): string {
  return model.provider ?? model.author;
}

/** The model's id on the Deni AI API: author-prefixed (e.g. `openai/gpt-6-sol`). */
export function getDeniApiModelId(model: ModelDefinition): string {
  return model.value.includes("/") ? model.value : `${model.author}/${model.value}`;
}

export type CatalogLanguageModel = {
  model: LanguageModel;
  providerOptions: CatalogProviderOptions;
};

export function createCatalogLanguageModel({
  model: selectedModel,
  reasoningEffort,
  keys,
  extraBody,
  headers,
}: {
  model: ModelDefinition;
  /** Already resolved against the model's `efforts` (and any caller cap). */
  reasoningEffort?: ReasoningEffort;
  keys: CatalogProviderKeys;
  /** More request body fields for the model's provider (merged over the defaults here). */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}): CatalogLanguageModel {
  const apiKey = keys.deniApiKey?.trim();
  if (!apiKey) throw new CatalogProviderUnavailableError();

  const isOpenAIModel = selectedModel.author === "openai";
  const openaiReasoningEffort =
    isOpenAIModel &&
    reasoningEffort &&
    (openaiEffortOptions as readonly string[]).includes(reasoningEffort)
      ? reasoningEffort
      : undefined;

  const body: Record<string, unknown> = {
    // Other authors take the effort as the OpenAI-compatible field, which the AI SDK only
    // sends for OpenAI's own reasoning models.
    ...(!isOpenAIModel && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    // Anthropic automatic prompt caching: the breakpoint follows the growing conversation.
    ...(selectedModel.author === "anthropic" ? { cache_control: { type: "ephemeral" } } : {}),
    ...extraBody,
  };

  const model = createDeniApi({
    apiKey,
    baseURL: keys.deniApiBaseUrl,
    extraBody: body,
    headers,
  }).chat(getDeniApiModelId(selectedModel));

  // The Deni AI API is called through Chat Completions, which has no reasoning
  // summary option (the AI SDK warns on every request if it is set).
  const providerOptions = (
    openaiReasoningEffort ? { openai: { reasoningEffort: openaiReasoningEffort } } : {}
  ) as CatalogProviderOptions;

  return { model, providerOptions };
}
