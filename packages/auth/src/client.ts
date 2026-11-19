import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  anonymousClient,
  lastLoginMethodClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { TWO_FACTOR_PATH } from "./paths";

export type CreateDeniAuthClientOptions = {
  /** Public origin of the auth server (the web app's NEXT_PUBLIC_BETTER_AUTH_URL). */
  baseURL: string;
};

/**
 * React auth client with the plugins the `createAuth()` server enables. The
 * caller owns the base URL (read from its own env).
 */
export function createDeniAuthClient({ baseURL }: CreateDeniAuthClientOptions) {
  return createAuthClient({
    baseURL,
    plugins: [
      anonymousClient(),
      twoFactorClient({
        // Prefer SPA navigation when possible; fall back is still a hard assign so
        // users never land on /chat without a completed second factor.
        onTwoFactorRedirect() {
          if (typeof window === "undefined") return;
          // Keep any explicit redirectTo attached to the challenge page.
          window.location.assign(`${TWO_FACTOR_PATH}${window.location.search}`);
        },
      }),
      lastLoginMethodClient(),
      passkeyClient(),
      organizationClient(),
      // Sends the signed authorization query from /oauth/* pages with consent requests.
      oauthProviderClient(),
    ],
  });
}

export type DeniAuthClient = ReturnType<typeof createDeniAuthClient>;
