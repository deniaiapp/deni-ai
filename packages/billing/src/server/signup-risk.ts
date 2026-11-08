import { eq } from "drizzle-orm";
import { signupRisk } from "@deniai/db";

import type { UsageEngineDatabase, UsageEngineLogger } from "./database";

/**
 * Whether the account's sign-up was flagged as part of a batch (`signup_risk`).
 * A failed lookup treats the account as not flagged.
 */
export async function isSignupFlagged(
  userId: string,
  database: Pick<UsageEngineDatabase, "select">,
  logger: UsageEngineLogger = console,
): Promise<boolean> {
  try {
    const [row] = await database
      .select({ userId: signupRisk.userId })
      .from(signupRisk)
      .where(eq(signupRisk.userId, userId))
      .limit(1);
    return Boolean(row);
  } catch (error) {
    logger.warn("[signup-risk] lookup failed; treating the account as not flagged", error);
    return false;
  }
}
