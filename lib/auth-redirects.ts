import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuthSession } from "./auth";

/** Sends visitors who already have a session away from the sign-in and sign-up pages. */
export const redirectSignedIn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAuthSession();
  if (session?.user.twoFactorEnabled) throw redirect({ to: "/" });
  if (session?.user.id) throw redirect({ to: "/two-factor/setup" });
});
