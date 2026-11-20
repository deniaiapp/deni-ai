import { db } from "@/db/drizzle";
import { signupAttribution } from "@/db/schema";
import { parseSignupAttribution } from "@/lib/signup-attribution";

/**
 * Stores where a new account came from, read from the sign-up request's cookies
 * (the OAuth callback and the magic-link request carry them too). Accounts with
 * no attribution cookie get no row.
 */
export async function recordSignupAttribution({
  userId,
  headers,
}: {
  userId: string;
  headers: Headers | undefined;
}) {
  const attribution = parseSignupAttribution(headers?.get("cookie"));
  if (!attribution) return;
  await db
    .insert(signupAttribution)
    .values({ userId, ...attribution })
    .onConflictDoNothing();
}
