import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  detectClientSignal,
  isClientSignalEnforcementEnabled,
  isLegacyAiSdkUserAgent,
} from "../utils/deni/clientSignal";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("detectClientSignal", () => {
  test("detects Codex via originator and user-agent", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          originator: "codex_cli_rs",
          "user-agent": "codex_cli_rs/0.144.0",
        }),
      ),
      { allowed: true, client: "codex" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent":
            "codex_vscode/0.94.0-alpha.7 (Mac OS 26.2.0; arm64) vscode/2.4.22",
        }),
      ),
      { allowed: true, client: "codex" },
    );
  });

  test("detects Claude Code via user-agent, x-app, and anthropic-beta", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "claude-cli/2.1.75",
          "x-app": "cli",
        }),
      ),
      { allowed: true, client: "claude_code" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "claude-code/2.1.45",
        }),
      ),
      { allowed: true, client: "claude_code" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "x-app": "cli",
          "anthropic-version": "2023-06-01",
        }),
      ),
      { allowed: true, client: "claude_code" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        }),
      ),
      { allowed: true, client: "claude_code" },
    );
  });

  test("detects OpenCode via user-agent and originator", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "opencode/1.14.39 ai-sdk/provider-utils/4.0.23",
        }),
      ),
      { allowed: true, client: "opencode" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          originator: "opencode",
        }),
      ),
      { allowed: true, client: "opencode" },
    );
  });

  test("detects Zed via originator and user-agent", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          originator: "zed",
          "user-agent":
            "zed/0.145.0 (Windows 10.0.29639; x86_64) unknown (zed; 1.13.2+stable.335.5cdb7ab9d9546db683132cfa78e68acec3064cac)",
        }),
      ),
      { allowed: true, client: "zed" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "zed/0.145.0 (macOS 15.0; arm64) unknown (zed; 1.0.0)",
        }),
      ),
      { allowed: true, client: "zed" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          originator: "zed",
        }),
      ),
      { allowed: true, client: "zed" },
    );
  });

  test("detects Flixa CLI via user-agent, x-client, and x-flixa-client", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "flixa-cli/0.1.0",
        }),
      ),
      { allowed: true, client: "flixa_cli" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "x-client": "flixa-cli",
        }),
      ),
      { allowed: true, client: "flixa_cli" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "x-flixa-client": "cli/0.1.0",
        }),
      ),
      { allowed: true, client: "flixa_cli" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          originator: "flixa-cli",
        }),
      ),
      { allowed: true, client: "flixa_cli" },
    );
  });

  test("detects Flixa via user-agent, x-flixa-client, and referer", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "flixa-sdk/1.0",
        }),
      ),
      { allowed: true, client: "flixa" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "x-flixa-client": "extension",
        }),
      ),
      { allowed: true, client: "flixa" },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          referer: "https://flixa.deniai.app/",
        }),
      ),
      { allowed: true, client: "flixa" },
    );
  });

  test("rejects bare curl / scripts with no client signal", () => {
    assert.deepEqual(detectClientSignal(headers({})), {
      allowed: false,
      client: null,
    });

    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "curl/8.7.1",
        }),
      ),
      { allowed: false, client: null },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "python-requests/2.32.0",
        }),
      ),
      { allowed: false, client: null },
    );
  });

  test("legacy ai-sdk UAs are not allowed signals (soft-reject path)", () => {
    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "ai/4.0.0",
        }),
      ),
      { allowed: false, client: null },
    );

    assert.deepEqual(
      detectClientSignal(
        headers({
          "user-agent": "ai-sdk/provider-utils/4.0.23",
        }),
      ),
      { allowed: false, client: null },
    );
  });
});

describe("isLegacyAiSdkUserAgent", () => {
  test("matches UA starting with ai/ or ai-sdk", () => {
    assert.equal(isLegacyAiSdkUserAgent(headers({ "user-agent": "ai/4.0.0" })), true);
    assert.equal(
      isLegacyAiSdkUserAgent(
        headers({ "user-agent": "ai-sdk/provider-utils/4.0.23" }),
      ),
      true,
    );
    assert.equal(isLegacyAiSdkUserAgent(headers({ "user-agent": "AI-SDK/1.0" })), true);
  });

  test("does not match unrelated or mid-string ai-sdk", () => {
    assert.equal(isLegacyAiSdkUserAgent(headers({ "user-agent": "curl/8.7.1" })), false);
    assert.equal(
      isLegacyAiSdkUserAgent(
        headers({
          "user-agent": "opencode/1.14.39 ai-sdk/provider-utils/4.0.23",
        }),
      ),
      false,
    );
    assert.equal(isLegacyAiSdkUserAgent(headers({ "user-agent": "flixa-sdk/1.0" })), false);
    assert.equal(isLegacyAiSdkUserAgent(headers({})), false);
  });
});

describe("isClientSignalEnforcementEnabled", () => {
  test("defaults to enabled", () => {
    const previous = process.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    delete process.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    assert.equal(isClientSignalEnforcementEnabled(), true);
    if (previous === undefined) {
      delete process.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    } else {
      process.env.FLIXA_REQUIRE_CLIENT_SIGNAL = previous;
    }
  });

  test("can be disabled via env", () => {
    const previous = process.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    process.env.FLIXA_REQUIRE_CLIENT_SIGNAL = "false";
    assert.equal(isClientSignalEnforcementEnabled(), false);
    if (previous === undefined) {
      delete process.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    } else {
      process.env.FLIXA_REQUIRE_CLIENT_SIGNAL = previous;
    }
  });
});
