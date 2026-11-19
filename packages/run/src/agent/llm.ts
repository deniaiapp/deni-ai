import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getApiKey } from "../data/config";
import { parseRunMode, RUN_MODES, SUMMARY_MODEL_ID, type RunMode } from "./model";
import { readStore } from "../data/store";
import { runDeps } from "../runtime";

/** Neither the platform nor the user has an OpenRouter key: Run cannot call a model. */
export class LlmUnconfiguredError extends Error {
  readonly code = "llm_unconfigured";
  constructor() {
    super("OPENROUTER_API_KEY is missing");
    this.name = "LlmUnconfiguredError";
  }
}

export function isLlmUnconfiguredError(error: unknown): error is LlmUnconfiguredError {
  return (error as { code?: unknown } | null)?.code === "llm_unconfigured";
}

/** Whether a model can be called for this user (a host override, the platform key, or the user's own). */
export async function hasLanguageModel(userId: string) {
  return Boolean(runDeps().languageModel) || Boolean(await getApiKey(userId));
}

export async function getDeniModel(userId: string, runMode?: RunMode) {
  const mode = RUN_MODES[runMode ?? parseRunMode((await readStore(userId)).config.runMode)];
  const override = runDeps().languageModel;
  if (override) {
    return {
      model: override(mode.modelId),
      modelId: mode.modelId,
      runMode: mode.id,
      providerOptions: undefined,
    };
  }
  const apiKey = await getApiKey(userId);
  if (!apiKey) throw new LlmUnconfiguredError();
  const extraBody = {
    reasoning: { effort: mode.effort },
    reasoning_effort: mode.effort,
    // Anthropic automatic prompt caching: the breakpoint follows the growing conversation.
    cache_control: { type: "ephemeral" },
    // A signed thinking block whose earlier conversation changed (trimming, slimmed tool output)
    // is dropped by Anthropic instead of failing the whole request. OpenRouter passes this through.
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
  };
  const openrouter = createOpenRouter({
    apiKey,
    extraBody,
    headers: { "anthropic-beta": "thinking-binding-controls-2026-08-01" },
  });
  return {
    // Report each request's cost: Deni Run usage is billed in USD against the Deni AI plan.
    model: openrouter(mode.modelId, { usage: { include: true } }),
    modelId: mode.modelId,
    runMode: mode.id,
    providerOptions: {
      openrouter: {
        extraBody,
      },
    },
  };
}

/** A small, cheap model for housekeeping such as summarizing old conversation history. */
export async function getSummaryModel(userId: string) {
  const override = runDeps().languageModel;
  if (override) return { model: override(SUMMARY_MODEL_ID), modelId: SUMMARY_MODEL_ID };
  const apiKey = await getApiKey(userId);
  if (!apiKey) throw new LlmUnconfiguredError();
  return {
    // Haiku 5.5 thinks by default, and thinking counts against maxOutputTokens: a short limit cut
    // answers off mid-sentence. Housekeeping needs little of it.
    model: createOpenRouter({ apiKey })(SUMMARY_MODEL_ID, {
      usage: { include: true },
      reasoning: { effort: "low" },
    }),
    modelId: SUMMARY_MODEL_ID,
  };
}
