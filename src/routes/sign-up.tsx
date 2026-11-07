import { createFileRoute } from "@tanstack/react-router";
import { useExtracted } from "@/i18n/react";
import { redirectSignedIn } from "@/lib/auth/redirects";
import { SocialAuth } from "@/components/account/auth-form";

export const Route = createFileRoute("/sign-up")({
  beforeLoad: () => redirectSignedIn(),
  component: SignUpPage,
});

function SignUpPage() {
  const t = useExtracted();
  return <SocialAuth title={t("Create an account")} mode="sign-up" />;
}
