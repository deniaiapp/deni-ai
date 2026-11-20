import { createDeniApi } from "@deniai/ai/deni-api";
import { getModelDefinition } from "@deniai/ai/models";
import {
  createCatalogLanguageModel,
  isCatalogProviderUnavailableError,
  type CatalogProviderKeys,
} from "@deniai/ai/provider";
import {
  parseRunMode,
  runModeForAccount,
  splitRunMode,
  SUMMARY_MODEL_ID,
  type RunMode,
} from "./model";
import { modelAccess } from "../billing/usage";
import { readStore } from "../data/store";
import { runConfig, runDeps } from "../runtime";

/** The Deni AI API key is missing: Run cannot call a model. */
export class LlmUnconfiguredError extends Error {
  readonly code = "llm_unconfigured";
  constructor() {
    super("The model provider is not configured");
    this.name = "LlmUnconfiguredError";
  }
}

export function isLlmUnconfiguredError(error: unknown): error is LlmUnconfiguredError {
  return (error as { code?: unknown } | null)?.code === "llm_unconfigured";
}

/** Whether a model can be called (a host override, or the Deni AI API key). */
export async function hasLanguageModel(_userId: string) {
  return Boolean(runDeps().languageModel) || Boolean(runConfig().deniApiKey);
}

function providerKeys(): CatalogProviderKeys {
  const config = runConfig();
  return { deniApiKey: config.deniApiKey, deniApiBaseUrl: config.deniApiBaseUrl };
}

/**
 * The mode a turn of this user really runs on: the given (or saved) mode when the plan and
 * this server allow its model, else a usable one. The plan rules are the chat rules.
 */
export async function effectiveRunMode(userId: string, runMode?: RunMode): Promise<RunMode> {
  const mode = parseRunMode(runMode ?? (await readStore(userId)).config.runMode);
  if (runDeps().languageModel) return mode;
  const access = await modelAccess(userId).catch(() => null);
  // Without the plan the saved model stays: the budget check of the turn reports the failure.
  if (!access) return mode;
  return runModeForAccount(mode, access);
}

/** Run's own request options for Anthropic models, tuned for long tool loops. */
const ANTHROPIC_EXTRA_BODY = {
  // A signed thinking block whose earlier conversation changed (trimming, slimmed tool output)
  // is dropped by Anthropic instead of failing the whole request. The Deni AI API passes the
  // field and the beta header below on to Anthropic.
  thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
};
const ANTHROPIC_HEADERS = { "anthropic-beta": "thinking-binding-controls-2026-08-01" };

/**
 * The language model of a Run turn. `modelId` is the catalog id usage is charged for. Models
 * are the chat catalog's and are called like chat's, through the Deni AI API
 * (`@deniai/ai/provider`); Anthropic models also get Run's own request options.
 */
export async function getDeniModel(userId: string, runMode?: RunMode) {
  const mode = await effectiveRunMode(userId, runMode);
  const { model: modelId, reasoningEffort } = splitRunMode(mode);
  const definition = getModelDefinition(modelId);
  const override = runDeps().languageModel;
  if (override) {
    return { model: override(modelId), modelId, runMode: mode, providerOptions: undefined };
  }
  if (!definition) throw new LlmUnconfiguredError();
  const anthropic = definition.author === "anthropic";
  try {
    const resolved = createCatalogLanguageModel({
      model: definition,
      reasoningEffort,
      keys: providerKeys(),
      extraBody: anthropic ? ANTHROPIC_EXTRA_BODY : undefined,
      headers: anthropic ? ANTHROPIC_HEADERS : undefined,
    });
    return {
      model: resolved.model,
      modelId,
      runMode: mode,
      providerOptions: resolved.providerOptions,
    };
  } catch (error) {
    if (isCatalogProviderUnavailableError(error)) throw new LlmUnconfiguredError();
    throw error;
  }
}

/** A small, cheap model for housekeeping such as summarizing old conversation history. */
export async function getSummaryModel(_userId: string) {
  const override = runDeps().languageModel;
  if (override) return { model: override(SUMMARY_MODEL_ID), modelId: SUMMARY_MODEL_ID };
  const { deniApiKey, deniApiBaseUrl } = providerKeys();
  if (!deniApiKey) throw new LlmUnconfiguredError();
  return {
    // Haiku 5.5 thinks by default, and thinking counts against maxOutputTokens: a short limit cut
    // answers off mid-sentence. Housekeeping needs little of it.
    model: createDeniApi({
      apiKey: deniApiKey,
      baseURL: deniApiBaseUrl,
      extraBody: { reasoning_effort: "low" },
    }).chat(SUMMARY_MODEL_ID),
    modelId: SUMMARY_MODEL_ID,
  };
}
