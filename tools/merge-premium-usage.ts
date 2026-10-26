/**
 * One-off migration to the shared usage pool: moves each user's current-period
 * premium usage into their basic row, counted at `--factor` (default 2, since
 * premium usage was worth about twice as much and former premium models now use
 * twice their old multiplier), and clears the premium row.
 *
 * Requests no longer record premium usage, so a premium row only holds usage from
 * before the change and the move is idempotent: a second run finds nothing to move.
 * The exact per-model mix is not stored, so the factor applies to all premium usage
 * (Claude Sonnet 5.5, which stayed at 1.5x, is counted at the factor too).
 *
 * Dry run by default; pass `--apply` to write. Loads `.env` (production) through
 * the package script; run after deploying the shared-pool release and migration.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../src/db/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const factorArg = args.find((arg) => arg.startsWith("--factor="));
const factor = factorArg ? Number(factorArg.slice("--factor=".length)) : 2;
if (!Number.isFinite(factor) || factor < 0) {
  console.error(`Invalid --factor value: ${factorArg}`);
  process.exit(1);
}

const db = drizzle({ connection: { url: databaseUrl, max: 1, prepare: false }, schema });
const { usageQuota } = schema;
const now = new Date();

const premiumRows = await db
  .select()
  .from(usageQuota)
  .where(
    and(
      eq(usageQuota.category, "premium"),
      eq(usageQuota.unit, "tokens"),
      gt(usageQuota.used, 0),
      gt(usageQuota.periodEnd, now),
    ),
  );

let movedUsers = 0;
let premiumTotal = 0;
let addedTotal = 0;

for (const premium of premiumRows) {
  const added = Math.round(premium.used * factor);
  premiumTotal += premium.used;
  addedTotal += added;
  if (!apply) continue;

  await db.transaction(async (tx) => {
    // The same per-user lock the app takes for quota writes.
    await tx.execute(sql`SELECT id FROM "user" WHERE id = ${premium.userId} FOR UPDATE`);
    const [current] = await tx
      .select()
      .from(usageQuota)
      .where(and(eq(usageQuota.userId, premium.userId), eq(usageQuota.category, "premium")))
      .limit(1);
    // Re-read under the lock: another run or a settlement may have changed it.
    if (!current || current.used <= 0 || !current.periodEnd || current.periodEnd <= now) return;
    const amount = Math.round(current.used * factor);
    const [basic] = await tx
      .select()
      .from(usageQuota)
      .where(and(eq(usageQuota.userId, premium.userId), eq(usageQuota.category, "basic")))
      .limit(1);
    const basicIsCurrent =
      basic && basic.unit === "tokens" && basic.periodEnd !== null && basic.periodEnd > now;

    if (basicIsCurrent) {
      await tx
        .update(usageQuota)
        .set({ used: sql`${usageQuota.used} + ${amount}`, updatedAt: now })
        .where(eq(usageQuota.id, basic.id));
    } else if (basic) {
      // An expired basic row starts the premium row's period with the moved usage.
      await tx
        .update(usageQuota)
        .set({
          used: amount,
          unit: "tokens",
          planTier: current.planTier,
          periodStart: current.periodStart,
          periodEnd: current.periodEnd,
          updatedAt: now,
        })
        .where(eq(usageQuota.id, basic.id));
    } else {
      await tx.insert(usageQuota).values({
        userId: current.userId,
        category: "basic",
        planTier: current.planTier,
        limitAmount: current.limitAmount,
        unit: "tokens",
        used: amount,
        periodStart: current.periodStart,
        periodEnd: current.periodEnd,
      });
    }
    await tx
      .update(usageQuota)
      .set({ used: 0, updatedAt: now })
      .where(eq(usageQuota.id, current.id));
    movedUsers++;
  });
}

const summary = `${premiumRows.length} user(s) with premium usage this period: ${premiumTotal.toLocaleString()} premium units -> +${addedTotal.toLocaleString()} shared units (x${factor}).`;
if (!apply) {
  console.log(`[dry run] ${summary} Pass --apply to write.`);
} else {
  console.log(`${summary} Moved for ${movedUsers} user(s).`);
}
process.exit(0);
