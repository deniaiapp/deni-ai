import { createFileRoute } from "@tanstack/react-router";
import { useExtracted } from "@/i18n/react";
import { redirectSignedIn } from "@/lib/auth-redirects";
import { SocialAuth } from "../components/auth-form";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: () => redirectSignedIn(),
  component: SignInPage,
});

function SignInPage() {
  const t = useExtracted();
  const { error } = Route.useSearch();
  return <SocialAuth title={t("Sign in")} mode="sign-in" error={error} />;
}
