import { getProviderId } from "@better-auth-ui/core";
import { useAuth } from "@better-auth-ui/react";

import { cn } from "@/lib/utils";
import { ProviderButton } from "./provider-button";

export type ProviderButtonsProps = {
  socialLayout?: SocialLayout;
};

export type SocialLayout = "auto" | "horizontal" | "vertical" | "grid";

/**
 * Render sign-in buttons for configured social providers. Each button owns its own sign-in mutation
 * and reads the shared sign-in pending state from React Query.
 *
 * @param socialLayout - Preferred layout for the provider buttons; `"auto"` chooses based on the number of providers.
 */
export function ProviderButtons({ socialLayout = "auto" }: ProviderButtonsProps) {
  const { socialProviders } = useAuth();

  const resolvedSocialLayout =
    socialLayout === "auto"
      ? socialProviders?.length && socialProviders.length >= 4
        ? "horizontal"
        : "vertical"
      : socialLayout;

  return (
    <div
      className={cn(
        "gap-3",
        resolvedSocialLayout === "grid" && "grid grid-cols-2",
        resolvedSocialLayout === "vertical" && "flex flex-col",
        resolvedSocialLayout === "horizontal" && "flex flex-row flex-wrap",
      )}
    >
      {socialProviders?.map((provider) => (
        <ProviderButton
          key={getProviderId(provider)}
          provider={provider}
          display={
            resolvedSocialLayout === "vertical"
              ? "full"
              : resolvedSocialLayout === "grid"
                ? "name"
                : "icon"
          }
          className={cn(resolvedSocialLayout === "horizontal" && "flex-1")}
        />
      ))}
    </div>
  );
}
