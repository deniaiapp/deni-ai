import { runConfig } from "../runtime";
import type { Store } from "../types";

/**
 * The key Run calls models with: the platform's Deni AI API key. Keys users saved for
 * OpenRouter before Run moved to the Deni AI API (`config.apiKey`) are no longer used.
 */
export async function getApiKey(
  _userId: string,
  _existingStore?: Pick<Store, "config">,
): Promise<string> {
  return runConfig().deniApiKey ?? "";
}

export async function hasApiKey(
  userId: string,
  existingStore?: Pick<Store, "config">,
): Promise<boolean> {
  return Boolean(await getApiKey(userId, existingStore));
}
