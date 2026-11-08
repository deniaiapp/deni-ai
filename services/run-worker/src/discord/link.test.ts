import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  configureRunForTest,
  createRunTestDb,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "@deniai/run/testing";
import {
  createDiscordLinkCode,
  describeLinkedAccount,
  getDiscordLinkByDiscordId,
  getDiscordPrefs,
  redeemDiscordLinkCode,
  talkToTeammate,
  unlinkDiscord,
} from "./link";
import { formatLinkCode, hashLinkCode, looksLikeLinkCode, normalizeLinkCode } from "./link-code";

let testDb: RunTestDb;

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb);
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, "alice");
  await seedTestUser(testDb.pglite, "bob");
});

const discord = (id: string) => ({ id, username: `${id}-name` });

describe("link code format", () => {
  it("normalizes typed codes to the stored hash", () => {
    expect(normalizeLinkCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(formatLinkCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(hashLinkCode(normalizeLinkCode(" abcd efgh"))).toBe(hashLinkCode("ABCDEFGH"));
    expect(looksLikeLinkCode("abcd-efgh")).toBe(true);
    // 0, O, 1, I and L are never issued.
    expect(looksLikeLinkCode("ABCD-EFG0")).toBe(false);
    expect(looksLikeLinkCode("hello there")).toBe(false);
  });
});

describe("Discord linking", () => {
  it("links the Discord account of whoever redeems a fresh code, exactly once", async () => {
    const { code } = await createDiscordLinkCode("alice", "ja");
    const stored = await testDb.pglite.query<{ code_hash: string }>(
      "SELECT code_hash FROM run_discord_link_codes WHERE user_id = $1",
      ["alice"],
    );
    expect(stored.rows[0]?.code_hash).toBe(hashLinkCode(normalizeLinkCode(code)));

    expect(await redeemDiscordLinkCode(code.toLowerCase(), discord("d1"))).toBe("alice");
    expect(await redeemDiscordLinkCode(code, discord("d2"))).toBeNull();
    expect(await getDiscordLinkByDiscordId("d1")).toMatchObject({
      userId: "alice",
      locale: "ja",
      botId: null,
    });
    expect(await describeLinkedAccount("alice")).toBe("alice (a***@example.com)");
  });

  it("revokes the previous code when a new one is issued; expired codes never redeem", async () => {
    const first = await createDiscordLinkCode("alice");
    const second = await createDiscordLinkCode("alice");
    expect(await redeemDiscordLinkCode(first.code, discord("d1"))).toBeNull();
    await testDb.pglite.query(
      "UPDATE run_discord_link_codes SET expires_at = now() - interval '1 minute'",
    );
    expect(await redeemDiscordLinkCode(second.code, discord("d1"))).toBeNull();
  });

  it("moves a Discord account to the user who links it last", async () => {
    await redeemDiscordLinkCode((await createDiscordLinkCode("alice")).code, discord("d1"));
    await redeemDiscordLinkCode((await createDiscordLinkCode("bob")).code, discord("d1"));
    expect((await getDiscordLinkByDiscordId("d1"))?.userId).toBe("bob");
    expect(await unlinkDiscord("alice")).toBe(false);
    expect(await unlinkDiscord("bob")).toBe(true);
  });

  it("stores the chosen teammate and leaves any group", async () => {
    await redeemDiscordLinkCode((await createDiscordLinkCode("alice")).code, discord("d1"));
    await talkToTeammate("alice", "research");
    expect((await getDiscordLinkByDiscordId("d1"))?.botId).toBe("research");
    expect(await getDiscordPrefs("alice")).toEqual({ threadId: null, notify: true });
  });
});
