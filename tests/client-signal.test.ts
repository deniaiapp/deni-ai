import { describe, expect, test } from "bun:test";
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
    expect(
      detectClientSignal(
        headers({
          originator: "codex_cli_rs",
          "user-agent": "codex_cli_rs/0.144.0",
        }),
      ),
    ).toEqual({ allowed: true, client: "codex" });

    expect(
      detectClientSignal(
        headers({
          "user-agent":
            "codex_vscode/0.94.0-alpha.7 (Mac OS 26.2.0; arm64) vscode/2.4.22",
        }),
      ),
    ).toEqual({ allowed: true, client: "codex" });
  });

  test("detects Claude Code via user-agent, x-app, and anthropic-beta", () => {
    expect(
      detectClientSignal(
        headers({
          "user-agent": "claude-cli/2.1.75",
          "x-app": "cli",
        }),
      ),
    ).toEqual({ allowed: true, client: "claude_code" });

    expect(
      detectClientSignal(
        headers({
          "user-agent": "claude-code/2.1.45",
        }),
      ),
    ).toEqual({ allowed: true, client: "claude_code" });

    expect(
      detectClientSignal(
        headers({
          "x-app": "cli",
          "anthropic-version": "2023-06-01",
        }),
      ),
    ).toEqual({ allowed: true, client: "claude_code" });

    expect(
      detectClientSignal(
        headers({
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        }),
      ),
    ).toEqual({ allowed: true, client: "claude_code" });
  });

  test("detects OpenCode via user-agent and originator", () => {
    expect(
      detectClientSignal(
        headers({
          "user-agent": "opencode/1.14.39 ai-sdk/provider-utils/4.0.23",
        }),
      ),
    ).toEqual({ allowed: true, client: "opencode" });

    expect(
      detectClientSignal(
        headers({
          originator: "opencode",
        }),
      ),
    ).toEqual({ allowed: true, client: "opencode" });
  });

  test("detects Zed via originator and user-agent", () => {
    expect(
      detectClientSignal(
        headers({
          originator: "zed",
          "user-agent":
            "zed/0.145.0 (Windows 10.0.29639; x86_64) unknown (zed; 1.13.2+stable.335.5cdb7ab9d9546db683132cfa78e68acec3064cac)",
        }),
      ),
    ).toEqual({ allowed: true, client: "zed" });

    expect(
      detectClientSignal(
        headers({
          "user-agent": "zed/0.145.0 (macOS 15.0; arm64) unknown (zed; 1.0.0)",
        }),
      ),
    ).toEqual({ allowed: true, client: "zed" });

    expect(
      detectClientSignal(
        headers({
          originator: "zed",
        }),
      ),
    ).toEqual({ allowed: true, client: "zed" });
  });

  test("detects Flixa CLI via user-agent, x-client, and x-flixa-client", () => {
    expect(
      detectClientSignal(
        headers({
          "user-agent": "flixa-cli/0.1.0",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa_cli" });

    expect(
      detectClientSignal(
        headers({
          "x-client": "flixa-cli",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa_cli" });

    expect(
      detectClientSignal(
        headers({
          "x-flixa-client": "cli/0.1.0",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa_cli" });

    expect(
      detectClientSignal(
        headers({
          originator: "flixa-cli",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa_cli" });
  });

  test("detects Flixa via user-agent, x-flixa-client, and referer", () => {
    expect(
      detectClientSignal(
        headers({
          "user-agent": "flixa-sdk/1.0",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa" });

    expect(
      detectClientSignal(
        headers({
          "x-flixa-client": "extension",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa" });

    expect(
      detectClientSignal(
        headers({
          referer: "https://flixa.deniai.app/",
        }),
      ),
    ).toEqual({ allowed: true, client: "flixa" });
  });

  test("rejects bare curl / scripts with no client signal", () => {
    expect(detectClientSignal(headers({}))).toEqual({
      allowed: false,
      client: null,
    });

    expect(
      detectClientSignal(
        headers({
          "user-agent": "curl/8.7.1",
        }),
      ),
    ).toEqual({ allowed: false, client: null });

    expect(
      detectClientSignal(
        headers({
          "user-agent": "python-requests/2.32.0",
        }),
      ),
    ).toEqual({ allowed: false, client: null });
  });

  test("legacy ai-sdk UAs are not allowed signals (soft-reject path)", () => {
    expect(
      detectClientSignal(
        headers({
          "user-agent": "ai/4.0.0",
        }),
      ),
    ).toEqual({ allowed: false, client: null });

    expect(
      detectClientSignal(
        headers({
          "user-agent": "ai-sdk/provider-utils/4.0.23",
        }),
      ),
    ).toEqual({ allowed: false, client: null });
  });
});

describe("isLegacyAiSdkUserAgent", () => {
  test("matches UA starting with ai/ or ai-sdk", () => {
    expect(isLegacyAiSdkUserAgent(headers({ "user-agent": "ai/4.0.0" }))).toBe(
      true,
    );
    expect(
      isLegacyAiSdkUserAgent(
        headers({ "user-agent": "ai-sdk/provider-utils/4.0.23" }),
      ),
    ).toBe(true);
    expect(
      isLegacyAiSdkUserAgent(headers({ "user-agent": "AI-SDK/1.0" })),
    ).toBe(true);
  });

  test("does not match unrelated or mid-string ai-sdk", () => {
    expect(
      isLegacyAiSdkUserAgent(headers({ "user-agent": "curl/8.7.1" })),
    ).toBe(false);
    expect(
      isLegacyAiSdkUserAgent(
        headers({
          "user-agent": "opencode/1.14.39 ai-sdk/provider-utils/4.0.23",
        }),
      ),
    ).toBe(false);
    expect(
      isLegacyAiSdkUserAgent(headers({ "user-agent": "flixa-sdk/1.0" })),
    ).toBe(false);
    expect(isLegacyAiSdkUserAgent(headers({}))).toBe(false);
  });
});

describe("isClientSignalEnforcementEnabled", () => {
  test("defaults to enabled", () => {
    const previous = Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    delete Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    expect(isClientSignalEnforcementEnabled()).toBe(true);
    if (previous === undefined) {
      delete Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    } else {
      Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL = previous;
    }
  });

  test("can be disabled via env", () => {
    const previous = Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL = "false";
    expect(isClientSignalEnforcementEnabled()).toBe(false);
    if (previous === undefined) {
      delete Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL;
    } else {
      Bun.env.FLIXA_REQUIRE_CLIENT_SIGNAL = previous;
    }
  });
});
