"use client";

import { Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useExtracted } from "next-intl";
import { Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { OAUTH_LOGIN_PATH } from "@/lib/auth-paths";
import { signInPath } from "@/lib/sign-in-redirect";

/**
 * OAuth provider login page. The provider sends signed-out (and guest) users
 * here with the authorization request; sign-in returns to this page, which then
 * resumes the request at the authorize endpoint with the new session.
 */
function OAuthAuthorizeContent() {
  const t = useExtracted();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const { data: session, isPending } = authClient.useSession();
  const isAnonymous = Boolean(session?.user?.isAnonymous);
  const canResume = Boolean(session?.user) && !isAnonymous && searchParams.has("client_id");

  useEffect(() => {
    if (canResume) window.location.replace(`/api/auth/oauth2/authorize?${query}`);
  }, [canResume, query]);

  if (isPending || canResume) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const signInHref = signInPath(`${OAUTH_LOGIN_PATH}?${query}`);
  const invalid = !searchParams.has("client_id");

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <XCircle className="size-6 text-destructive" />
          </div>
          <CardTitle>{invalid ? t("Invalid Request") : t("Sign in required")}</CardTitle>
          <CardDescription>
            {invalid
              ? t("This sign-in link is incomplete. Please start again from the app.")
              : t(
                  "Guest accounts cannot sign in to other apps. Please sign in with a permanent account to continue.",
                )}
          </CardDescription>
        </CardHeader>
        {!invalid && (
          <CardContent className="flex justify-center">
            <Button render={<Link href={signInHref} />} nativeButton={false}>
              {t("Log in")}
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <OAuthAuthorizeContent />
    </Suspense>
  );
}
