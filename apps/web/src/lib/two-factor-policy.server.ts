import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { account } from "@/db/schema";
import { env } from "@/env";
import {
  evaluateTwoFactorPolicy,
  parseTwoFactorDeadline,
  type TwoFactorPolicy,
} from "@/lib/two-factor-policy";

type PolicyUser = {
  id: string;
  isAnonymous?: boolean | null;
  twoFactorEnabled?: boolean | null;
};

/**
 * The two-factor rule for a signed-in user. Reads the linked providers only
 * when they can change the answer (not for guests or accounts with 2FA on).
 */
export async function getTwoFactorPolicyForUser(user: PolicyUser | null): Promise<TwoFactorPolicy> {
  const requiredFrom = parseTwoFactorDeadline(env.PASSWORD_2FA_REQUIRED_FROM);
  if (!user) {
    return { status: "exempt", deadline: requiredFrom?.toISOString() ?? null };
  }
  const isAnonymous = Boolean(user.isAnonymous);
  const twoFactorEnabled = Boolean(user.twoFactorEnabled);
  const providerIds =
    isAnonymous || twoFactorEnabled
      ? ["credential"]
      : (
          await db
            .select({ providerId: account.providerId })
            .from(account)
            .where(eq(account.userId, user.id))
        ).map((row) => row.providerId);

  return evaluateTwoFactorPolicy({
    isAnonymous,
    twoFactorEnabled,
    providerIds,
    now: new Date(),
    requiredFrom,
  });
}
