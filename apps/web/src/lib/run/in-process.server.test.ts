import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    RUN_ENABLED: true,
    RUN_SCHEDULER_IN_PROCESS: "true" as string | undefined,
    RUN_DISCORD_ENABLED: false,
    DISCORD_BOT_TOKEN: undefined as string | undefined,
    RUN_SHUTDOWN_TIMEOUT_MS: undefined as string | undefined,
  },
  ensureRunConfigured: vi.fn(() => ({ ok: true }) as { ok: boolean; message?: string }),
  setRunNotificationHook: vi.fn(),
  stopInProcessScheduler: vi.fn(async () => undefined),
  startDiscordBot: vi.fn(() => ({ stop: vi.fn(async () => undefined) })),
  pushNotificationToDiscord: vi.fn(async () => true),
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/run/runtime.server", () => ({
  ensureRunConfigured: mocks.ensureRunConfigured,
  setRunNotificationHook: mocks.setRunNotificationHook,
  stopInProcessScheduler: mocks.stopInProcessScheduler,
}));
vi.mock("@deniai/run/discord/bot", () => ({ startDiscordBot: mocks.startDiscordBot }));
vi.mock("@deniai/run/discord/push", () => ({
  pushNotificationToDiscord: mocks.pushNotificationToDiscord,
}));

const { inProcessRunPlan, startInProcessRun, DEFAULT_RUN_SHUTDOWN_TIMEOUT_MS } =
  await import("@/lib/run/in-process.server");
const { runShutdownHandlers } = await import("@/lib/shutdown.server");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(async () => {
  await runShutdownHandlers();
  vi.clearAllMocks();
  Object.assign(mocks.env, {
    RUN_ENABLED: true,
    RUN_SCHEDULER_IN_PROCESS: "true",
    RUN_DISCORD_ENABLED: false,
    DISCORD_BOT_TOKEN: undefined,
    RUN_SHUTDOWN_TIMEOUT_MS: undefined,
  });
});

const base = {
  runEnabled: true,
  schedulerInProcess: "true",
  discordEnabled: false,
  discordToken: undefined,
  shutdownTimeoutMs: undefined,
};

test("the plan follows RUN_ENABLED, RUN_SCHEDULER_IN_PROCESS and the Discord settings", () => {
  expect(inProcessRunPlan(base)).toEqual({
    scheduler: true,
    discordToken: null,
    shutdownTimeoutMs: DEFAULT_RUN_SHUTDOWN_TIMEOUT_MS,
  });
  expect(inProcessRunPlan({ ...base, schedulerInProcess: undefined }).scheduler).toBe(false);
  expect(inProcessRunPlan({ ...base, runEnabled: false }).scheduler).toBe(false);
  expect(
    inProcessRunPlan({ ...base, discordEnabled: true, discordToken: " token " }).discordToken,
  ).toBe("token");
  expect(inProcessRunPlan({ ...base, discordEnabled: true }).discordToken).toBeNull();
  expect(
    inProcessRunPlan({
      ...base,
      schedulerInProcess: "false",
      discordEnabled: true,
      discordToken: "t",
    }).discordToken,
  ).toBeNull();
  expect(inProcessRunPlan({ ...base, shutdownTimeoutMs: "3000" }).shutdownTimeoutMs).toBe(3000);
});

test("without RUN_SCHEDULER_IN_PROCESS nothing starts", async () => {
  mocks.env.RUN_SCHEDULER_IN_PROCESS = undefined;
  await startInProcessRun(logger);
  expect(mocks.ensureRunConfigured).not.toHaveBeenCalled();
});

test("the scheduler starts at boot and stops with the server, waiting for jobs", async () => {
  mocks.env.RUN_SHUTDOWN_TIMEOUT_MS = "5000";
  await startInProcessRun(logger);
  expect(mocks.ensureRunConfigured).toHaveBeenCalledOnce();
  expect(mocks.startDiscordBot).not.toHaveBeenCalled();
  expect(mocks.setRunNotificationHook).not.toHaveBeenCalled();

  await runShutdownHandlers();
  expect(mocks.stopInProcessScheduler).toHaveBeenCalledWith(5000, logger);
});

test("with RUN_DISCORD_ENABLED the bot runs here, gets notifications, and stops after the jobs", async () => {
  Object.assign(mocks.env, { RUN_DISCORD_ENABLED: true, DISCORD_BOT_TOKEN: "bot-token" });
  const stopBot = vi.fn(async () => undefined);
  mocks.startDiscordBot.mockReturnValueOnce({ stop: stopBot });
  const order: string[] = [];
  mocks.stopInProcessScheduler.mockImplementationOnce(async () => {
    order.push("scheduler");
  });
  stopBot.mockImplementationOnce(async () => {
    order.push("bot");
  });

  await startInProcessRun(logger);
  expect(mocks.startDiscordBot).toHaveBeenCalledWith("bot-token");
  const hook = mocks.setRunNotificationHook.mock.calls[0]?.[0] as (n: unknown) => Promise<void>;
  const notification = { userId: "u1", jobId: null, kind: "routine", title: "t", body: "b" };
  await hook(notification);
  expect(mocks.pushNotificationToDiscord).toHaveBeenCalledWith("u1", notification);

  await runShutdownHandlers();
  expect(order).toEqual(["scheduler", "bot"]);
});

test("a Run configuration error is logged and nothing starts", async () => {
  mocks.ensureRunConfigured.mockReturnValueOnce({ ok: false, message: "bad RUN_S3_ENDPOINT" });
  await startInProcessRun(logger);
  expect(logger.error).toHaveBeenCalledWith(
    "[run] in-process worker not started:",
    "bad RUN_S3_ENDPOINT",
  );
  await runShutdownHandlers();
  expect(mocks.stopInProcessScheduler).not.toHaveBeenCalled();
});
