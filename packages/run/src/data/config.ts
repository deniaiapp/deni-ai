import { runConfig } from "../runtime";
import { readStore } from "./store";
import { decryptSecret } from "./secrets";
import type { Store } from "../types";

export async function getApiKey(
  userId: string,
  existingStore?: Pick<Store, "config">,
): Promise<string> {
  const platform = runConfig().openrouterApiKey;
  if (platform) return platform;
  const store = existingStore ?? (await readStore(userId));
  const stored = decryptSecret(store.config.apiKey).trim();
  if (!stored || stored.startsWith("xai-")) return "";
  return stored;
}

export async function hasApiKey(
  userId: string,
  existingStore?: Pick<Store, "config">,
): Promise<boolean> {
  return Boolean(await getApiKey(userId, existingStore));
}
