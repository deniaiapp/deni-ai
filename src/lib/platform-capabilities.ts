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
  /**
   * deniai.app is split between v7 and v8 by the rollout Worker
   * (`ROLLOUT_SWITCH_ENABLED`): the account menu offers trying v8.
   */
  rolloutSwitch: boolean;
};

export function isModelProviderAvailable(
  capabilities: PlatformCapabilities,
  provider: string,
): boolean {
  return provider in capabilities.models
    ? capabilities.models[provider as PlatformModelProvider]
    : false;
}
