import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getApiKey } from "./config";
import { DENI_MODEL_ID, parseRunMode, RUN_MODES, type RunMode } from "./model";
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
  };
  const openrouter = createOpenRouter({
    apiKey,
    extraBody,
  });
  return {
    model: openrouter(DENI_MODEL_ID),
    tokenMultiplier: mode.tokenMultiplier,
    runMode: mode.id,
    providerOptions: {
      openrouter: {
        extraBody,
      },
    },
  };
}
