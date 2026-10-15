import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuthenticatedUserId } from "@/lib/auth";
import { AccountScreen } from "../components/account-screen";

const requireUser = createServerFn({ method: "GET" }).handler(async () => {
  if (!(await getAuthenticatedUserId())) throw redirect({ to: "/sign-in" });
});

export const Route = createFileRoute("/account")({
  beforeLoad: () => requireUser(),
  component: AccountScreen,
});
