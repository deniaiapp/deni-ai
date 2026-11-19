import { PGlite } from "@electric-sql/pglite";
import { publicMigrationsFolder } from "@deniai/db/paths";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * Test-only helpers (`@deniai/billing/testing`): an isolated PostgreSQL/WASM
 * database with the real `public` migrations of `@deniai/db`, and fixtures for
 * the tables the usage engine reads. Never import this from production code.
 */
export type UsageTestDb = { pglite: PGlite; db: PgliteDatabase };

export async function createUsageTestDb(): Promise<UsageTestDb> {
  const pglite = new PGlite();
  // Production databases run in UTC; `timestamp` columns compare in the session zone.
  await pglite.exec("SET TIME ZONE 'UTC'");
  const db = drizzle({ client: pglite });
  await migrate(db, { migrationsFolder: publicMigrationsFolder });
  return { pglite, db };
}

const USAGE_TABLES = [
  "usage_reservation",
  "usage_quota",
  "product_usage",
  "max_mode_credit_lot",
  "max_mode_credit_account",
  "team_member_usage_policy",
  "team_usage_policy",
  "member",
  "billing",
  "signup_risk",
  "organization",
  `"user"`,
];

/** Empty every table the fixtures write (keeps the schema). */
export async function resetUsageTables(pglite: PGlite): Promise<void> {
  await pglite.exec(`TRUNCATE ${USAGE_TABLES.join(", ")} CASCADE`);
}

export async function seedUser(
  pglite: PGlite,
  id: string,
  { email = `${id}@example.com`, emailVerified = true, isAnonymous = false } = {},
): Promise<void> {
  await pglite.query(
    `INSERT INTO "user" (id, name, email, email_verified, is_anonymous) VALUES ($1, $1, $2, $3, $4)`,
    [id, email, emailVerified, isAnonymous],
  );
}

export async function seedBilling(
  pglite: PGlite,
  {
    id,
    userId = null,
    organizationId = null,
    planId,
    status = "active",
    maxModeEnabled = false,
    paymentMethodFingerprint = null,
    deletionPending = false,
    currentPeriodEnd = null,
  }: {
    id: string;
    userId?: string | null;
    organizationId?: string | null;
    planId: string | null;
    status?: string;
    maxModeEnabled?: boolean;
    paymentMethodFingerprint?: string | null;
    deletionPending?: boolean;
    currentPeriodEnd?: Date | null;
  },
): Promise<void> {
  await pglite.query(
    `INSERT INTO billing (id, user_id, organization_id, stripe_customer_id, plan_id, status,
       max_mode_enabled, payment_method_fingerprint, deletion_pending, current_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      userId,
      organizationId,
      `cus_${id}`,
      planId,
      status,
      maxModeEnabled,
      paymentMethodFingerprint,
      deletionPending,
      currentPeriodEnd?.toISOString() ?? null,
    ],
  );
}

/** An organization with its members (the first one is the owner). */
export async function seedTeam(
  pglite: PGlite,
  organizationId: string,
  memberIds: string[],
): Promise<void> {
  await pglite.query(
    `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $1, $1, NOW())`,
    [organizationId],
  );
  for (const [index, userId] of memberIds.entries()) {
    await pglite.query(
      `INSERT INTO member (id, organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [`${organizationId}:${userId}`, organizationId, userId, index === 0 ? "owner" : "member"],
    );
  }
}

/** A member's Max Mode policy on a team plan (`team_member_usage_policy`). */
export async function seedMemberPolicy(
  pglite: PGlite,
  {
    organizationId,
    userId,
    maxModeEnabled = true,
    maxModeLimit = null,
  }: {
    organizationId: string;
    userId: string;
    maxModeEnabled?: boolean;
    maxModeLimit?: number | null;
  },
): Promise<void> {
  await pglite.query(
    `INSERT INTO team_member_usage_policy
       (organization_id, user_id, max_mode_enabled, max_mode_limit_basic, max_mode_limit_premium)
     VALUES ($1, $2, $3, $4, $4)`,
    [organizationId, userId, maxModeEnabled, maxModeLimit],
  );
}

/** A prepaid Max Mode credit lot of `units` usage units for a user or an organization. */
export async function seedCreditLot(
  pglite: PGlite,
  {
    userId = null,
    organizationId = null,
    units,
    expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60_000),
  }: {
    userId?: string | null;
    organizationId?: string | null;
    units: number;
    expiresAt?: Date;
  },
): Promise<void> {
  await pglite.query(
    `INSERT INTO max_mode_credit_lot (user_id, organization_id, source, granted_units,
       remaining_units, amount_paid, currency, stripe_payment_intent_id, expires_at)
     VALUES ($1, $2, 'checkout', $3, $3, 100, 'usd', gen_random_uuid()::text, $4)`,
    [userId, organizationId, units, expiresAt.toISOString()],
  );
}

/** Deni Run spend this UTC month, in micro-dollars (`product_usage`, product `run`). */
export async function seedRunSpend(pglite: PGlite, userId: string, micros: number): Promise<void> {
  await pglite.query(
    `INSERT INTO product_usage (user_id, product, metric, unit, period_start, used)
     VALUES ($1, 'run', 'model', 'usd_micros',
       date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', $2)`,
    [userId, micros],
  );
}

export type QuotaRow = { category: string; used: number; unit: string | null; planTier: string };

export async function readQuota(pglite: PGlite, userId: string): Promise<QuotaRow[]> {
  const result = await pglite.query<{
    category: string;
    used: string | number;
    unit: string | null;
    plan_tier: string;
  }>(
    `SELECT category, used, unit, plan_tier FROM usage_quota WHERE user_id = $1 ORDER BY category`,
    [userId],
  );
  return result.rows.map((row) => ({
    category: row.category,
    used: Number(row.used),
    unit: row.unit,
    planTier: row.plan_tier,
  }));
}

export type ProductUsageRow = { product: string; metric: string; unit: string; used: number };

/** Chat and Flixa ledger rows (Deni Run rows are left out). */
export async function readProductUsage(pglite: PGlite, userId: string): Promise<ProductUsageRow[]> {
  const result = await pglite.query<{
    product: string;
    metric: string;
    unit: string;
    used: string | number;
  }>(
    `SELECT product, metric, unit, used FROM product_usage
     WHERE user_id = $1 AND product <> 'run' ORDER BY product, metric`,
    [userId],
  );
  return result.rows.map((row) => ({ ...row, used: Number(row.used) }));
}

export type ReservationRow = {
  id: string;
  product: string;
  reservedAmount: number;
  settledAmount: number | null;
  observedAmount: number;
  maxModeAmount: number;
  settled: boolean;
};

export async function readReservations(pglite: PGlite, userId: string): Promise<ReservationRow[]> {
  const result = await pglite.query<{
    id: string;
    product: string;
    reserved_amount: string | number;
    settled_amount: string | number | null;
    observed_amount: string | number;
    max_mode_amount: string | number;
    settled_at: Date | null;
  }>(
    `SELECT id, product, reserved_amount, settled_amount, observed_amount, max_mode_amount, settled_at
     FROM usage_reservation WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    product: row.product,
    reservedAmount: Number(row.reserved_amount),
    settledAmount: row.settled_amount === null ? null : Number(row.settled_amount),
    observedAmount: Number(row.observed_amount),
    maxModeAmount: Number(row.max_mode_amount),
    settled: row.settled_at !== null,
  }));
}

/** Remaining credit units of a user's or an organization's lots. */
export async function readCreditUnits(
  pglite: PGlite,
  owner: { userId: string } | { organizationId: string },
): Promise<number> {
  const result = await pglite.query<{ units: string | number | null }>(
    "organizationId" in owner
      ? `SELECT sum(remaining_units) AS units FROM max_mode_credit_lot WHERE organization_id = $1`
      : `SELECT sum(remaining_units) AS units FROM max_mode_credit_lot WHERE user_id = $1`,
    ["organizationId" in owner ? owner.organizationId : owner.userId],
  );
  return Number(result.rows[0]?.units ?? 0);
}
