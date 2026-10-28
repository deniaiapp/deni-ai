import { getProviderName } from "@better-auth-ui/core";
import {
  renderProviderIcon,
  useAuth,
  useFetchOptions,
  useListAccounts,
  useSession,
  useSignInEmail,
  useSignInSocial,
  useSignOut,
} from "@better-auth-ui/react";
import { type SyntheticEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useFreshSessionLocalization } from "@/hooks/use-fresh-session-localization";
import { cn } from "@/lib/utils";

export type FreshSessionPromptProps = {
  onVerified: () => void;
  className?: string;
};

/**
 * Inline controls letting the user re-verify their identity when better-auth
 * rejects a sensitive action with `SESSION_NOT_FRESH` — the session is valid
 * but older than the configured freshness window. Offers whichever re-auth
 * methods the account actually has (password and/or linked social
 * providers). On success, calls `onVerified` so the caller can retry
 * whatever originally failed.
 *
 * Contains no heading of its own — callers render a title/description
 * appropriate to their context (a dialog header, or plain text inline).
 */
export function FreshSessionPrompt({ onVerified, className }: FreshSessionPromptProps) {
  const { authClient, basePaths, localization, navigate, plugins, viewPaths } = useAuth();
  const freshSessionLocalization = useFreshSessionLocalization();
  const { data: session } = useSession(authClient);
  const { data: accounts } = useListAccounts(authClient);
  const { fetchOptions, resetFetchOptions } = useFetchOptions();

  const [password, setPassword] = useState("");
  const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;

  const hasCredentialAccount = accounts?.some((account) => account.providerId === "credential");
  const socialProviderIds: string[] = [];
  const seenSocialProviders = new Set<string>();
  for (const account of accounts ?? []) {
    if (account.providerId === "credential" || seenSocialProviders.has(account.providerId)) {
      continue;
    }
    seenSocialProviders.add(account.providerId);
    socialProviderIds.push(account.providerId);
  }
  const hasNoReauthMethod = !!accounts && !hasCredentialAccount && socialProviderIds.length === 0;

  const { mutate: signInEmail, isPending: isVerifyingPassword } = useSignInEmail(authClient, {
    onError: () => {
      resetFetchOptions();
    },
    onSuccess: () => {
      setPassword("");
      toast.success(freshSessionLocalization.success);
      onVerified();
    },
  });

  const { mutate: signInSocial, isPending: isRedirecting } = useSignInSocial(authClient);
  const { mutate: signOut } = useSignOut(authClient);

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!session?.user.email) return;

    signInEmail({ email: session.user.email, password, fetchOptions });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {hasCredentialAccount && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="fresh-session-password">{localization.auth.password}</Label>

            <Input
              id="fresh-session-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder={localization.auth.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isVerifyingPassword}
              required
            />

            <FieldError />
          </Field>

          {Captcha && <div className="flex justify-center">{Captcha}</div>}

          <Button
            type="submit"
            disabled={isVerifyingPassword || !password || (Boolean(Captcha) && !fetchOptions)}
          >
            {isVerifyingPassword && <Spinner />}
            {freshSessionLocalization.submit}
          </Button>
        </form>
      )}

      {hasCredentialAccount && socialProviderIds.length > 0 && (
        <FieldSeparator className="text-xs flex items-center">
          {localization.auth.or}
        </FieldSeparator>
      )}

      {socialProviderIds.map((providerId) => (
        <Button
          key={providerId}
          type="button"
          variant="outline"
          disabled={isRedirecting}
          onClick={() => signInSocial({ provider: providerId, callbackURL: window.location.href })}
        >
          {renderProviderIcon(providerId)}
          {localization.auth.continueWith.replace("{{provider}}", getProviderName(providerId))}
        </Button>
      ))}

      {hasNoReauthMethod && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{freshSessionLocalization.signIn}</p>

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              signOut(undefined, {
                onSuccess: () => {
                  navigate({ to: `${basePaths.auth}/${viewPaths.auth.signIn}` });
                },
              })
            }
          >
            {localization.auth.signOut}
          </Button>
        </div>
      )}
    </div>
  );
}
