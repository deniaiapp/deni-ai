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
   * beta-only UI (sidebar "Beta" label, beta feedback and "Go to Deni AI v7" links).
   */
  privateBeta: boolean;
};

export function isModelProviderAvailable(
  capabilities: PlatformCapabilities,
  provider: string,
): boolean {
  return provider in capabilities.models
    ? capabilities.models[provider as PlatformModelProvider]
    : false;
}
