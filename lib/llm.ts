import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getApiKey } from "./config";
import { parseRunMode, RUN_MODES, SUMMARY_MODEL_ID, type RunMode } from "./model";
import { readStore } from "./store";

export async function getDeniModel(userId: string, runMode?: RunMode) {
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }
  const mode = RUN_MODES[runMode ?? parseRunMode((await readStore(userId)).config.runMode)];
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
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }
  return {
    model: createOpenRouter({ apiKey })(SUMMARY_MODEL_ID, { usage: { include: true } }),
    modelId: SUMMARY_MODEL_ID,
  };
}
