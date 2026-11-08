/**
 * Creates (or resets) one email + password test account on a local database,
 * for clicking through the app without the sign-up CAPTCHA or email delivery.
 *
 *   node --env-file=.env.local scripts/seed-trial-user.ts [email]
 *
 * The generated password is written to `.trial-account.local` (gitignored),
 * never printed. Refuses to run against a database that is not on localhost.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set; pass --env-file=.env.local");
}
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) {
  throw new Error("Refusing to seed a database that is not on localhost");
}

const email = process.argv[2] ?? "trial@deniai.test";
const password = randomBytes(18).toString("base64url");
const sql = postgres(databaseUrl, { max: 1 });

try {
  const passwordHash = await hashPassword(password);
  await sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string }[]>`select id from "user" where email = ${email}`;
    const userId = existing?.id ?? randomUUID();
    if (!existing) {
      await tx`
        insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${userId}, ${"Trial User"}, ${email}, true, now(), now())`;
    }
    const updated = await tx`
      update account set password = ${passwordHash}, updated_at = now()
      where user_id = ${userId} and provider_id = 'credential'`;
    if (updated.count === 0) {
      await tx`
        insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
        values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${passwordHash}, now(), now())`;
    }
  });
  const target = join(import.meta.dirname, "..", ".trial-account.local");
  writeFileSync(target, `email=${email}\npassword=${password}\n`, { mode: 0o600 });
  console.log(`Seeded ${email}; credentials written to .trial-account.local`);
} finally {
  await sql.end();
}
