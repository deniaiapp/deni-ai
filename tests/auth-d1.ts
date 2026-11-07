import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./helpers/module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "@tanstack/react-start/server-only") return {};
  if (request === "@tanstack/react-start/server") return { getRequestHeaders: () => new Headers() };
  return undefined;
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let tempDir = "";

// Better Auth runs against the same D1/SQLite executor as the rest of the app. This walks
// the writes sign-in performs (user, linked account, session, 2FA, rate limit) and the
// cascade on account deletion, which Date/boolean/foreign-key handling can break.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-auth-"));
  if (process.env.VERIFY_D1_PROXY_URL) {
    process.env.D1_PROXY_URL = process.env.VERIFY_D1_PROXY_URL;
  } else {
    delete process.env.D1_PROXY_URL;
    process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  }
  process.env.BETTER_AUTH_SECRET ||= "verify-auth-secret-verify-auth-secret";
  process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { user, account, session, twoFactor } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const ctx = await auth.$context;
  const suffix = Date.now().toString(36);

  const created = await ctx.internalAdapter.createOAuthUser(
    { name: "Verify User", email: `verify-${suffix}@example.com`, emailVerified: true, image: null },
    { providerId: "google", accountId: `acct-${suffix}`, accessToken: "at", scope: "openid email profile", accessTokenExpiresAt: new Date(Date.now() + 3600_000) },
  );
  const userId = created.user.id;
  assert(created.user.createdAt instanceof Date, "createdAt did not round-trip as a Date");
  assert(created.user.emailVerified === true, "emailVerified did not round-trip as a boolean");

  const [row] = await db.select().from(user).where(eq(user.id, userId));
  assert(row?.emailVerified === true && row.twoFactorEnabled !== true, "user row has wrong booleans");

  const sess = await ctx.internalAdapter.createSession(userId);
  assert(sess.expiresAt.getTime() > Date.now(), "session expiry was not stored as a future Date");
  const found = await ctx.internalAdapter.findSession(sess.token);
  assert(found?.user.id === userId, "session lookup failed");

  const accounts = await ctx.internalAdapter.findAccounts(userId);
  assert(accounts.length === 1 && accounts[0]!.accessTokenExpiresAt instanceof Date, "account lookup failed");

  await ctx.internalAdapter.updateUser(userId, { name: "Renamed", twoFactorEnabled: true } as never);
  const [updated] = await db.select().from(user).where(eq(user.id, userId));
  assert(updated?.name === "Renamed" && updated.twoFactorEnabled === true, "updateUser did not persist");
  assert(updated.updatedAt.getTime() >= row.updatedAt.getTime(), "updatedAt was not refreshed");

  await db.insert(twoFactor).values({ id: `tf-${suffix}`, secret: "s", backupCodes: "b", userId });

  await ctx.internalAdapter.deleteUser(userId);
  const [gone] = await db.select().from(user).where(eq(user.id, userId));
  const orphans =
    (await db.select().from(account).where(eq(account.userId, userId))).length +
    (await db.select().from(session).where(eq(session.userId, userId))).length +
    (await db.select().from(twoFactor).where(eq(twoFactor.userId, userId))).length;
  assert(!gone && orphans === 0, "deleting the user did not cascade to account, session and two_factor");

  console.log("verified Better Auth on D1/SQLite: user, account, session, 2FA, update, cascade delete");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });
