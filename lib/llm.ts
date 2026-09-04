import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { DENI_MODEL_ID, DENI_REASONING_EFFORT } from "./model";
import { getApiKey } from "./config";

export async function getDeniModel(userId: string) {
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }
  const openrouter = createOpenRouter({
    apiKey,
    extraBody: {
      reasoning: { effort: DENI_REASONING_EFFORT },
      reasoning_effort: DENI_REASONING_EFFORT,
    },
  });
  return {
    model: openrouter(DENI_MODEL_ID),
    providerOptions: {
      openrouter: {
        extraBody: {
          reasoning: { effort: DENI_REASONING_EFFORT },
          reasoning_effort: DENI_REASONING_EFFORT,
        },
      },
    },
  };
}
