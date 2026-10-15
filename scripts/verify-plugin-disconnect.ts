import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./module-mocks";

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

// Disconnecting must stop the app using a plugin immediately, revoke the grant once the
// last plugin of a provider is gone, and never remove the sign-in account itself.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-plugin-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.BETTER_AUTH_SECRET ||= "verify-plugin-secret-verify-plugin-secret";
  process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
  process.env.DISABLED_PLUGINS = "";
  process.env.GITHUB_CLIENT_ID = "gh-client";
  process.env.GITHUB_CLIENT_SECRET = "gh-secret";

  const { db } = await import("../db");
  const { user, account } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const plugins = await import("../lib/builtin-plugins");
  const store = await import("../lib/store");

  const userId = "plugin-user";
  await db.insert(user).values({ id: userId, name: "P", email: "p@example.com", emailVerified: true });
  const base = "openid,email,profile";
  const gmail = "https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send";
  const drive = "https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/drive.file";
  await db.insert(account).values([
    { id: "a-google", accountId: "g1", providerId: "google", userId, scope: `${base},${gmail},${drive}`, accessToken: "g-access", refreshToken: "g-refresh" },
    { id: "a-github", accountId: "h1", providerId: "github", userId, scope: "user:email,repo", accessToken: "h-access" },
  ]);
  await store.mutateStore(userId, (s) => {
    s.pluginAlwaysAllow = { "gmail:send": true, "drive:create": true, "github:comment": true };
  });

  const calls: { url: string; method: string; body: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const status = (list: Awaited<ReturnType<typeof plugins.pluginStatus>>, kind: string) => list.find((item) => item.kind === kind)!;
  const row = async (id: string) => (await db.select().from(account).where(eq(account.id, id)))[0]!;

  // 1. Gmail goes while Drive stays: only Gmail's scopes are dropped, nothing is revoked yet.
  let after = await plugins.disconnectPlugin(userId, "gmail");
  assert(!status(after, "gmail").connected && status(after, "drive").connected, "gmail should be off, drive still on");
  assert(calls.length === 0, "Google must not be revoked while another Google plugin is connected");
  assert((await row("a-google")).refreshToken === "g-refresh", "tokens were cleared too early");
  assert((await store.readStore(userId)).pluginAlwaysAllow?.["gmail:send"] === undefined, "gmail always-allow survived");
  assert((await store.readStore(userId)).pluginAlwaysAllow?.["drive:create"] === true, "drive always-allow was removed");

  // 2. Drive goes last: the Google grant is revoked and tokens cleared, sign-in row stays.
  after = await plugins.disconnectPlugin(userId, "drive");
  assert(!status(after, "drive").connected, "drive should be off");
  assert(calls.length === 1 && calls[0]!.url === "https://oauth2.googleapis.com/revoke" && calls[0]!.body.includes("g-refresh"), "Google token was not revoked");
  const google = await row("a-google");
  assert(google.refreshToken === null && google.accessToken === null, "Google tokens were not cleared");
  assert(google.scope === base, `base sign-in scopes were not preserved: ${google.scope}`);

  // 3. GitHub: grant revoked with the app credentials, the login account is kept.
  after = await plugins.disconnectPlugin(userId, "github");
  assert(!status(after, "github").connected, "github should be off");
  const revoke = calls[1]!;
  assert(revoke.url === "https://api.github.com/applications/gh-client/token" && revoke.method === "DELETE" && revoke.body.includes("h-access"), "GitHub token was not revoked");
  const github = await row("a-github");
  assert(github.scope === "user:email" && github.accessToken === null, "GitHub scope or token not reset");

  // 4. A failed revocation leaves everything connected so the user can retry.
  await db.update(account).set({ scope: `${base},${gmail}`, refreshToken: "again" }).where(eq(account.id, "a-google"));
  globalThis.fetch = (async () => new Response("boom", { status: 503 })) as typeof fetch;
  let failed = false;
  try {
    await plugins.disconnectPlugin(userId, "gmail");
  } catch {
    failed = true;
  }
  assert(failed, "a failed revocation must surface an error");
  assert((await row("a-google")).scope === `${base},${gmail}` && (await row("a-google")).refreshToken === "again", "state changed despite failed revocation");

  // 5. Reading a disconnected plugin is refused.
  globalThis.fetch = realFetch;
  await db.update(account).set({ scope: base }).where(eq(account.id, "a-google"));
  let refused = false;
  try {
    await plugins.runPlugin(userId, "gmail", "search", { query: "x" });
  } catch {
    refused = true;
  }
  assert(refused, "a disconnected plugin must not be usable");

  console.log("verified plugin disconnect: scope trimming, Google/GitHub revocation, retry on failure, access refused");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });
