import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

// Billing profiles are cached per user, so every case uses its own user id.
process.env.FLIXA_BILLING_CACHE_TTL_MS = "0";

const database = await import("../utils/deni/db");
const getDeniPool = mock.fn(database.getDeniPool);
mock.module("../utils/deni/db", { exports: { ...database, getDeniPool } });
const { getDeniBillingProfile } = await import("../utils/deni/usage");
const { isEducationalEmail } = await import("@deniai/billing");

const db = new PGlite();

before(async () => {
  // Mirrors the columns of deni-ai's user, billing, and member tables that Flixa reads.
  await db.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY, email TEXT NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT false, is_anonymous BOOLEAN DEFAULT false
    );
    CREATE TABLE billing (
      user_id TEXT, organization_id TEXT, plan_id TEXT, status TEXT,
      current_period_end TIMESTAMPTZ, max_mode_enabled BOOLEAN DEFAULT false,
      payment_method_fingerprint TEXT, card_verified_at TIMESTAMPTZ
    );
    CREATE TABLE member (user_id TEXT, organization_id TEXT);
    INSERT INTO "user" (id, email, email_verified, is_anonymous) VALUES
      ('student', 'student@u-tokyo.ac.jp', true, false),
      ('unverified', 'student@mit.edu', false, false),
      ('guest', 'temp@mit.edu', true, true),
      ('regular', 'someone@outlook.com', true, false),
      ('paid', 'teacher@ox.ac.uk', true, false);
    INSERT INTO billing (user_id, plan_id, status, current_period_end) VALUES
      ('paid', 'plus_monthly', 'active', now() + interval '10 days');
  `);
  const pool = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
  } as unknown as Pool;
  getDeniPool.mock.mockImplementation(() => pool);
});

test("a verified educational address gets Go for free", async () => {
  assert.equal((await getDeniBillingProfile("student")).tier, "go");
});

test("unverified, guest, and non-educational addresses stay Free", async () => {
  assert.equal((await getDeniBillingProfile("unverified")).tier, "free");
  assert.equal((await getDeniBillingProfile("guest")).tier, "free");
  assert.equal((await getDeniBillingProfile("regular")).tier, "free");
});

test("a paid plan takes precedence over education", async () => {
  assert.equal((await getDeniBillingProfile("paid")).tier, "plus");
});

test("educational domains match deni-ai's restricted allowlist", () => {
  assert.equal(isEducationalEmail("a@cs.stanford.edu"), true);
  assert.equal(isEducationalEmail("a@school.ed.jp"), true);
  assert.equal(isEducationalEmail("a@foo.edu.co"), false);
  assert.equal(isEducationalEmail("a@cmuk.edu.kg"), false);
  assert.equal(isEducationalEmail("a@edu"), false);
});
