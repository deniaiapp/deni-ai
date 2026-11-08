import {
  createOpenRouter,
  type OpenRouterProvider,
  type OpenRouterProviderSettings,
} from "@openrouter/ai-sdk-provider";

const OPENROUTER_APP_URL = "https://deniai.app/";
const OPENROUTER_APP_NAME = "Deni AI";
const OPENROUTER_APP_CATEGORY = "general-chat";

export function createDeniOpenRouter(options: OpenRouterProviderSettings = {}): OpenRouterProvider {
  return createOpenRouter({
    ...options,
    appName: options.appName ?? OPENROUTER_APP_NAME,
    appUrl: options.appUrl ?? OPENROUTER_APP_URL,
    headers: {
      ...options.headers,
      "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORY,
    },
  });
}
