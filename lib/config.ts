import { readStore } from "./store";
import { decryptSecret } from "./secrets";

export async function getApiKey(userId: string): Promise<string> {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) return env;
  const store = await readStore(userId);
  const stored = decryptSecret(store.config.apiKey).trim();
  if (!stored || stored.startsWith("xai-")) return "";
  return stored;
}

export async function hasApiKey(userId: string): Promise<boolean> {
  return Boolean(await getApiKey(userId));
}
