import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureRunForTest, createRunTestDb, type RunTestDb } from "../testing";
import { seedBots } from "../data/seed";
import type { BrowserProvider, SandboxProvider } from "../computer/providers";
import { computerCapabilities } from "../computer/providers";
import { runCommand } from "../computer";
import { createDeniTools } from "./index";

let testDb: RunTestDb;

beforeAll(async () => {
  testDb = await createRunTestDb();
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

const fakeSandbox = { name: "fake", timeoutMs: 1_000, idleMs: 1_000 } as SandboxProvider;
const fakeBrowser = { name: "fake", idleMs: 1_000 } as BrowserProvider;

const ops = () => seedBots().find((bot) => bot.id === "ops")!;
const toolNames = (bot = ops()) =>
  Object.keys(createDeniTools({ userId: "u", bot, threadId: "dm_ops" })).sort();

describe("tools offered to a teammate", () => {
  beforeEach(() => {
    configureRunForTest(testDb, { computer: { sandbox: null, browser: null } });
  });

  it("leaves out the terminal and browser when no provider is configured", () => {
    const names = toolNames();
    expect(names).not.toContain("runCommand");
    expect(names).not.toContain("browser");
    expect(names).not.toContain("requestTakeover");
    expect(names).not.toContain("stopSandbox");
    expect(names).toContain("workspace");
    expect(names).not.toContain("builtInPlugin");
    expect(computerCapabilities()).toEqual({ browser: false, sandbox: false, files: true });
  });

  it("refuses a command with a clear error when the terminal is not configured", async () => {
    await expect(runCommand("u", "ls")).rejects.toMatchObject({ code: "computer_unconfigured" });
  });

  it("offers the computer tools once the providers are configured", () => {
    configureRunForTest(testDb, { computer: { sandbox: fakeSandbox, browser: fakeBrowser } });
    const names = toolNames();
    for (const name of ["runCommand", "browser", "requestTakeover", "stopSandbox", "workspace"])
      expect(names).toContain(name);
  });

  it("honours the teammate's tool groups and computer access", () => {
    configureRunForTest(testDb, { computer: { sandbox: fakeSandbox, browser: fakeBrowser } });
    const noComputer = toolNames({ ...ops(), computerAccess: false });
    for (const name of ["runCommand", "browser", "workspace", "stopSandbox", "registerArtifact"])
      expect(noComputer).not.toContain(name);
    expect(noComputer).toContain("remember");

    const memoryOnly = toolNames({ ...ops(), tools: ["memory"] });
    expect(memoryOnly).toContain("remember");
    expect(memoryOnly).toContain("conversationHistory");
    for (const name of ["mcp", "readSkill", "scheduleRoutine", "messageBot", "runCommand"])
      expect(memoryOnly).not.toContain(name);
  });
});
