import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuthenticatedUserId } from "@/lib/auth";
import { deniAiUrl } from "@/lib/deni-ai";
import { AccountScreen } from "../components/account-screen";

const requireUser = createServerFn({ method: "GET" }).handler(async () => {
  if (!(await getAuthenticatedUserId())) throw redirect({ to: "/sign-in" });
});

const loadAccount = createServerFn({ method: "GET" }).handler(async () => ({
  deniAiUrl: deniAiUrl(),
}));

export const Route = createFileRoute("/account")({
  beforeLoad: () => requireUser(),
  loader: () => loadAccount(),
  component: AccountPage,
});

function AccountPage() {
  const { deniAiUrl } = Route.useLoaderData();
  return <AccountScreen deniAiUrl={deniAiUrl} />;
}
