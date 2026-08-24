import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearClientSignalLogs,
  getClientSignalLogStats,
  queryClientSignalLogs,
  recordClientSignalLog,
} from "../utils/deni/clientSignalLog";

describe("clientSignalLog", () => {
  beforeEach(() => {
    clearClientSignalLogs();
  });

  test("records entries and returns newest first", () => {
    recordClientSignalLog({
      userId: "user-a",
      path: "/v1/agent/chat/completions",
      method: "POST",
      client: "codex",
      allowed: true,
      outcome: "allowed",
      headers: { "user-agent": "codex_cli_rs/1.0" },
    });
    recordClientSignalLog({
      userId: "user-b",
      path: "/v1/messages",
      method: "POST",
      client: null,
      allowed: false,
      outcome: "missing_banned",
      headers: { "user-agent": "curl/8" },
    });

    const all = queryClientSignalLogs({ limit: 10 });
    expect(all).toHaveLength(2);
    expect(all[0]!.userId).toBe("user-b");
    expect(all[1]!.userId).toBe("user-a");
    expect(getClientSignalLogStats().count).toBe(2);
  });

  test("filters by userId substring, client, and outcome", () => {
    recordClientSignalLog({
      userId: "abc-111",
      path: "/v1/a",
      method: "POST",
      client: "flixa_cli",
      allowed: true,
      outcome: "allowed",
      headers: {},
    });
    recordClientSignalLog({
      userId: "abc-222",
      path: "/v1/b",
      method: "POST",
      client: "codex",
      allowed: true,
      outcome: "allowed",
      headers: {},
    });
    recordClientSignalLog({
      userId: "zzz",
      path: "/v1/c",
      method: "POST",
      client: null,
      allowed: false,
      outcome: "missing_banned",
      headers: {},
    });

    expect(queryClientSignalLogs({ userId: "abc" })).toHaveLength(2);
    expect(queryClientSignalLogs({ client: "codex" })).toHaveLength(1);
    expect(queryClientSignalLogs({ client: "none" })[0]!.userId).toBe("zzz");
    expect(queryClientSignalLogs({ outcome: "missing_banned" })).toHaveLength(
      1,
    );
    expect(queryClientSignalLogs({ allowed: false })).toHaveLength(1);
  });

  test("filters by redacted apiKey substring", () => {
    recordClientSignalLog({
      userId: "user-a",
      apiKey: "deni_abc1…wxyz",
      path: "/v1/a",
      method: "POST",
      client: "codex",
      allowed: true,
      outcome: "allowed",
      headers: {},
    });
    recordClientSignalLog({
      userId: "user-b",
      apiKey: "deni_zzzz…0000",
      path: "/v1/b",
      method: "POST",
      client: "zed",
      allowed: true,
      outcome: "allowed",
      headers: {},
    });

    expect(queryClientSignalLogs({ apiKey: "abc1" })).toHaveLength(1);
    expect(queryClientSignalLogs({ apiKey: "abc1" })[0]!.userId).toBe("user-a");
    expect(queryClientSignalLogs({ apiKey: "deni_" })).toHaveLength(2);
  });
});
