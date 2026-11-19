import { describe, expect, it } from "vitest";
import { describeWorkerConfig, readWorkerConfig } from "./config";

const DB = "postgresql://worker:secret@db.example:5432/deni";

describe("readWorkerConfig", () => {
  it("requires a database URL and accepts DENI_DATABASE_URL", () => {
    expect(() => readWorkerConfig({})).toThrow(/DATABASE_URL/);
    expect(readWorkerConfig({ DENI_DATABASE_URL: DB }).databaseUrl).toBe(DB);
  });

  it("runs the scheduler by default and turns it off with RUN_SCHEDULER_ENABLED=false", () => {
    expect(readWorkerConfig({ DATABASE_URL: DB }).scheduler).toBe(true);
    expect(readWorkerConfig({ DATABASE_URL: DB, RUN_SCHEDULER_ENABLED: "false" }).scheduler).toBe(
      false,
    );
  });

  it("starts Discord only when both the flag and the token are set", () => {
    expect(readWorkerConfig({ DATABASE_URL: DB, DISCORD_BOT_TOKEN: "t" }).discord).toBeNull();
    expect(readWorkerConfig({ DATABASE_URL: DB, RUN_DISCORD_ENABLED: "true" }).discord).toBeNull();
    expect(
      readWorkerConfig({
        DATABASE_URL: DB,
        RUN_DISCORD_ENABLED: "true",
        DISCORD_BOT_TOKEN: "t",
        DISCORD_INVITE_URL: "https://discord.example/install",
      }).discord,
    ).toEqual({ token: "t", inviteUrl: "https://discord.example/install" });
  });

  it("describes itself without credentials", () => {
    const summary = describeWorkerConfig(
      readWorkerConfig({ DATABASE_URL: DB, RUN_DISCORD_ENABLED: "true", DISCORD_BOT_TOKEN: "tok" }),
    );
    expect(summary).toEqual({
      database: "db.example:5432/deni",
      scheduler: true,
      discord: true,
      shutdownTimeoutMs: 60_000,
    });
    expect(JSON.stringify(summary)).not.toMatch(/secret|tok/);
  });
});
