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
    /** Guest sign-in is offered (off behind the private beta gate). */
    guests: boolean;
  };
  /**
   * This deployment runs the private beta gate (`BETA_ACCESS_REQUIRED`): shows the
   * beta-only UI (sidebar "Beta" label, "Go to Deni AI v7" link) and "Send feedback".
   */
  privateBeta: boolean;
  /**
   * deniai.app is split between v7 and v8 by the rollout Worker
   * (`ROLLOUT_SWITCH_ENABLED`): the account menu offers going back to v7 and
   * "Send feedback" (the help center's v8 form).
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
