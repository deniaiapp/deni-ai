import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuthSession } from "@/lib/auth";
import { emailOtpAvailable } from "@/lib/auth/two-factor-delivery";
import { TwoFactorSetupForm } from "@/components/account/auth-form";

const loadSetup = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAuthSession();
  if (!session?.user.id) throw redirect({ to: "/sign-in" });
  if (session.user.twoFactorEnabled) throw redirect({ to: "/" });
  return { email: session.user.email, emailAvailable: emailOtpAvailable() };
});

export const Route = createFileRoute("/two-factor/setup")({
  loader: () => loadSetup(),
  component: TwoFactorSetupPage,
});

function TwoFactorSetupPage() {
  const { email, emailAvailable } = Route.useLoaderData();
  return <TwoFactorSetupForm email={email} emailAvailable={emailAvailable} />;
}
