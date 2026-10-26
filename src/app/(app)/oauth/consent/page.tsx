"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useExtracted } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

type ConsentResult = { redirectUri: string } | { error: string };

// Plain helper so the React Compiler does not lower try/catch control flow.
async function submitConsent(accept: boolean): Promise<ConsentResult> {
  try {
    // oauthProviderClient() attaches the signed authorization query of this page.
    const { data, error } = await authClient.oauth2.consent({ accept });
    if (error || !data?.url) return { error: error?.message ?? "Consent failed" };
    return { redirectUri: data.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Consent failed" };
  }
}

function OAuthConsentContent() {
  const t = useExtracted();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const scopes = (searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  const [clientName, setClientName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void authClient.oauth2.publicClient({ query: { client_id: clientId } }).then(({ data }) => {
      if (!cancelled) setClientName(data?.client_name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const scopeLabel = (scope: string) => {
    switch (scope) {
      case "openid":
        return t("Confirm your identity");
      case "profile":
        return t("Read your name and profile picture");
      case "email":
        return t("Read your email address");
      case "offline_access":
        return t("Stay signed in");
      default:
        return scope;
    }
  };

  const respond = async (accept: boolean) => {
    setIsSubmitting(true);
    setErrorMessage("");
    const result = await submitConsent(accept);
    if ("redirectUri" in result) {
      window.location.assign(result.redirectUri);
      return;
    }
    setErrorMessage(result.error);
    setIsSubmitting(false);
  };

  const appName = clientName ?? clientId ?? t("An app");

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="size-6 text-primary" />
          </div>
          <CardTitle>{t("Sign in to {app} with Deni AI", { app: appName })}</CardTitle>
          <CardDescription>{t("{app} will be able to:", { app: appName })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {scopes.map((scope) => (
              <li key={scope}>{scopeLabel(scope)}</li>
            ))}
          </ul>
          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={isSubmitting || !clientId}
              onClick={() => respond(false)}
            >
              {t("Deny")}
            </Button>
            <Button
              className="flex-1"
              disabled={isSubmitting || !clientId}
              onClick={() => respond(true)}
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : t("Allow")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <OAuthConsentContent />
    </Suspense>
  );
}
