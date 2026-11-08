export type PlatformModelProvider = "openai" | "anthropic" | "google" | "xai" | "deni";
export type SocialProviderId = "google" | "github";

export type PlatformCapabilities = {
  models: Record<PlatformModelProvider, boolean>;
  features: {
    webSearch: boolean;
    memory: boolean;
    billing: boolean;
  };
  auth: {
    socialProviders: SocialProviderId[];
    captcha: boolean;
    /** Email sending is configured: verification, password reset and magic links work. */
    email: boolean;
  };
};

export function isModelProviderAvailable(
  capabilities: PlatformCapabilities,
  provider: string,
): boolean {
  return provider in capabilities.models
    ? capabilities.models[provider as PlatformModelProvider]
    : false;
}
