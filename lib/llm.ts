import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getApiKey } from "./config";
import { parseRunMode, RUN_MODES, type RunMode } from "./model";
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
  };
  const openrouter = createOpenRouter({
    apiKey,
    extraBody,
  });
  return {
    model: openrouter(mode.modelId),
    tokenMultiplier: mode.tokenMultiplier,
    runMode: mode.id,
    providerOptions: {
      openrouter: {
        extraBody,
      },
    },
  };
}
