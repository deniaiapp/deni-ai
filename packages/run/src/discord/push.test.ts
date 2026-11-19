import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureRunForTest,
  createRunTestDb,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "../testing";
import { createJob } from "../jobs/index";
import { readStore } from "../data/store";
import { createDiscordLinkCode, redeemDiscordLinkCode, setDiscordPrefs } from "./link";
import {
  formatDiscordNotification,
  pushNotificationToDiscord,
  resetDiscordPushForTests,
} from "./push";

let testDb: RunTestDb;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb, { config: { appUrl: "https://app.example" } });
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, "alice");
  await readStore("alice");
  resetDiscordPushForTests();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith("/users/@me/channels")
      ? Response.json({ id: "channel-1" })
      : Response.json({ id: "message-1" }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function linkAlice() {
  const { code } = await createDiscordLinkCode("alice");
  await redeemDiscordLinkCode(code, { id: "discord-alice", username: "alice" });
}

async function job(kind: "routine" | "chat") {
  return createJob({
    userId: "alice",
    threadId: "dm_chief",
    botId: "chief",
    kind,
    payload: {},
    idempotencyKey: `${kind}-1`,
  });
}

describe("pushNotificationToDiscord", () => {
  it("DMs background results to the linked account with a link to Run mode", async () => {
    await linkAlice();
    const routine = await job("routine");
    const sent = await pushNotificationToDiscord("alice", {
      jobId: routine.id,
      title: "Chief finished a task",
      body: "Inbox summary is ready.",
    });
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, message] = fetchMock.mock.calls[1]!;
    const body = JSON.parse(String(message?.body)) as {
      content: string;
      allowed_mentions: unknown;
    };
    expect(body.content).toContain("**Chief finished a task**");
    expect(body.content).toContain("https://app.example/run");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("respects /notify off, skips chat replies and unlinked users", async () => {
    const routine = await job("routine");
    expect(
      await pushNotificationToDiscord("alice", { jobId: routine.id, title: "t", body: "b" }),
    ).toBe(false);
    await linkAlice();
    await setDiscordPrefs("alice", { notify: false });
    expect(
      await pushNotificationToDiscord("alice", { jobId: routine.id, title: "t", body: "b" }),
    ).toBe(false);
    await setDiscordPrefs("alice", { notify: true });
    const chat = await job("chat");
    expect(
      await pushNotificationToDiscord("alice", { jobId: chat.id, title: "t", body: "b" }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing without a bot token", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    await linkAlice();
    const routine = await job("routine");
    expect(
      await pushNotificationToDiscord("alice", { jobId: routine.id, title: "t", body: "b" }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a DM within Discord's 2,000 characters", () => {
    const text = formatDiscordNotification(
      { title: "T", body: "x".repeat(5_000) },
      (message, params) => message.replace("{url}", String(params?.url ?? "")),
      "https://app.example/run",
    );
    expect(text.length).toBeLessThanOrEqual(2_000);
  });
});
