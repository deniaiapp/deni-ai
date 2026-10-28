import {
  authMutationKeys,
  getProviderId,
  getProviderName,
  type AuthSocialProvider,
} from "@better-auth-ui/core";
import { renderProviderIcon, useAuth, useSignInSocial } from "@better-auth-ui/react";
import { useIsMutating } from "@tanstack/react-query";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toSafeRedirectPath } from "@/lib/auth-redirect";

export type ProviderButtonProps = {
  provider: AuthSocialProvider;
  display?: "full" | "name" | "icon";
} & Omit<ComponentProps<typeof Button>, "onClick" | "children" | "disabled">;

/**
 * Social provider sign-in button.
 *
 * @param provider - Provider to sign in with.
 * @param display - `"full"` (e.g. "Continue with Google"), `"name"` (just the provider name), or `"icon"` (icon only).
 */
/** The auth page the user is on, minus a previous `?error=`, for failed callbacks to return to. */
function currentAuthPagePath() {
  const url = new URL(window.location.href);
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  return `${url.pathname}${url.search}`;
}

export function ProviderButton({
  provider,
  display = "full",
  variant = "outline",
  ...props
}: ProviderButtonProps) {
  const { authClient, baseURL, localization, redirectTo } = useAuth();

  const callbackURL = `${baseURL}${toSafeRedirectPath(redirectTo)}`;

  const { mutate: signInSocial, isPending: signInSocialPending } = useSignInSocial(authClient);

  const providerIcon = renderProviderIcon(provider);

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  });
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  });
  const isPending = signInMutating + signUpMutating > 0;

  return (
    <Button
      type="button"
      variant={variant}
      disabled={isPending}
      onClick={() =>
        signInSocial({
          provider: getProviderId(provider),
          callbackURL,
          // Without it Better Auth shows its bare error page (e.g. a Gmail address
          // used with GitHub); back on this page OAuthErrorAlert explains it.
          errorCallbackURL: `${baseURL}${currentAuthPagePath()}`,
        })
      }
      {...props}
      aria-label={getProviderName(provider)}
    >
      {signInSocialPending ? <Spinner /> : providerIcon}

      {display === "full"
        ? localization.auth.continueWith.replace("{{provider}}", getProviderName(provider))
        : display === "name"
          ? getProviderName(provider)
          : null}
    </Button>
  );
}
