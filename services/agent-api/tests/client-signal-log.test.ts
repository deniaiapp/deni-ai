import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
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
      outcome: "missing_rejected",
      headers: { "user-agent": "curl/8" },
    });

    const all = queryClientSignalLogs({ limit: 10 });
    assert.equal(all.length, 2);
    assert.equal(all[0]!.userId, "user-b");
    assert.equal(all[1]!.userId, "user-a");
    assert.equal(getClientSignalLogStats().count, 2);
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
      outcome: "missing_rejected",
      headers: {},
    });

    assert.equal(queryClientSignalLogs({ userId: "abc" }).length, 2);
    assert.equal(queryClientSignalLogs({ client: "codex" }).length, 1);
    assert.equal(queryClientSignalLogs({ client: "none" })[0]!.userId, "zzz");
    assert.equal(queryClientSignalLogs({ outcome: "missing_rejected" }).length, 1);
    assert.equal(queryClientSignalLogs({ allowed: false }).length, 1);
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

    assert.equal(queryClientSignalLogs({ apiKey: "abc1" }).length, 1);
    assert.equal(queryClientSignalLogs({ apiKey: "abc1" })[0]!.userId, "user-a");
    assert.equal(queryClientSignalLogs({ apiKey: "deni_" }).length, 2);
  });
});
