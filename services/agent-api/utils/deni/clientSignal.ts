/**
 * Detect allowed coding-agent / Flixa client signals.
 *
 * Abuse prevention: Deni AI API keys must only be used from known clients
 * (Codex, Claude Code, OpenCode, Zed, Flixa VS Code / SDK, Flixa CLI).
 * Requests without a matching signal are treated as unauthorized automation
 * and trigger a Flixa ban.
 */

export type KnownClient =
  | "codex"
  | "claude_code"
  | "opencode"
  | "zed"
  | "flixa"
  | "flixa_cli";

export type ClientSignalResult =
  | { allowed: true; client: KnownClient }
  | { allowed: false; client: null };

function headerValue(headers: Headers, name: string): string {
  return (headers.get(name) || "").trim();
}

function lower(value: string): string {
  return value.toLowerCase();
}

/**
 * Whether client-signal enforcement is enabled.
 * Set FLIXA_REQUIRE_CLIENT_SIGNAL=false to disable (e.g. local debugging).
 */
export function isClientSignalEnforcementEnabled(): boolean {
  const raw = process.env.FLIXA_REQUIRE_CLIENT_SIGNAL?.toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  // Default: enforce (abuse prevention is on unless explicitly disabled).
  return true;
}

/**
 * Optional shared secret for first-party Flixa clients.
 * When set, `x-flixa-signal: <secret>` is accepted as a Flixa signal.
 */
function hasFlixaSignalSecret(headers: Headers): boolean {
  const expected = process.env.FLIXA_CLIENT_SIGNAL_SECRET;
  if (!expected) return false;

  const provided = headerValue(headers, "x-flixa-signal");
  if (!provided) return false;

  // Constant-time-ish compare for short secrets (best-effort).
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Legacy Vercel AI SDK / older Flixa traffic.
 * UA typically starts with `ai/` or `ai-sdk` — ask for update instead of ban.
 */
export function isLegacyAiSdkUserAgent(headers: Headers): boolean {
  const userAgent = lower(headerValue(headers, "user-agent"));
  return userAgent.startsWith("ai/") || userAgent.startsWith("ai-sdk");
}

/**
 * Detect which allowed client (if any) sent this request.
 */
export function detectClientSignal(headers: Headers): ClientSignalResult {
  const userAgent = lower(headerValue(headers, "user-agent"));
  const originator = lower(headerValue(headers, "originator"));
  const xApp = lower(headerValue(headers, "x-app"));
  const xClient = lower(
    headerValue(headers, "x-client") || headerValue(headers, "x-flixa-client"),
  );
  const anthropicBeta = lower(headerValue(headers, "anthropic-beta"));
  const anthropicVersion = headerValue(headers, "anthropic-version");
  const referer = lower(
    headerValue(headers, "referer") || headerValue(headers, "http-referer"),
  );

  const xFlixaClient = lower(headerValue(headers, "x-flixa-client"));

  // ── Flixa CLI (first-party terminal client) ──────────────────────────────
  // Recommended headers (any one is enough):
  //   User-Agent: flixa-cli/<version>
  //   x-client: flixa-cli
  //   x-flixa-client: cli/<version>
  //   originator: flixa-cli
  if (
    userAgent.includes("flixa-cli") ||
    userAgent.includes("flixa_cli") ||
    xClient === "flixa-cli" ||
    xClient === "flixa_cli" ||
    xClient.startsWith("flixa-cli/") ||
    xClient.startsWith("flixa_cli/") ||
    xFlixaClient === "cli" ||
    xFlixaClient.startsWith("cli/") ||
    xFlixaClient.includes("flixa-cli") ||
    originator === "flixa-cli" ||
    originator === "flixa_cli" ||
    originator.startsWith("flixa-cli")
  ) {
    return { allowed: true, client: "flixa_cli" };
  }

  // ── Flixa (first-party extension / SDK) ──────────────────────────────────
  // Recommended headers:
  //   User-Agent: flixa-vscode/<version> | flixa-sdk/<version>
  //   x-flixa-client: vscode/<version> | sdk
  //   x-client: flixa-vscode
  if (
    hasFlixaSignalSecret(headers) ||
    userAgent.includes("flixa") ||
    xClient.includes("flixa") ||
    xFlixaClient.length > 0 ||
    referer.includes("flixa.deniai.app") ||
    referer.includes("flixa.")
  ) {
    return { allowed: true, client: "flixa" };
  }

  // ── Codex (OpenAI Codex CLI / IDE / TUI) ─────────────────────────────────
  // Real Codex traffic uses originator + User-Agent like:
  //   originator: codex_cli_rs
  //   User-Agent: codex_cli_rs/<version> (...)
  // Also: codex_vscode, codex-tui, and generic "codex/" prefixes.
  if (
    originator.includes("codex") ||
    /codex_cli_rs|codex_vscode|codex-tui|\bcodex\//i.test(userAgent) ||
    userAgent.includes("codex_cli") ||
    userAgent.includes("openai-codex")
  ) {
    return { allowed: true, client: "codex" };
  }

  // ── Claude Code (Anthropic CLI / VS Code extension) ──────────────────────
  // Signals observed in the wild:
  //   User-Agent: claude-cli/<ver> | claude-code/<ver>
  //   x-app: cli
  //   anthropic-beta: ...claude-code-...
  //   anthropic-version present with x-app=cli
  if (
    /claude-cli|claude-code/i.test(userAgent) ||
    anthropicBeta.includes("claude-code") ||
    (xApp === "cli" && anthropicVersion.length > 0) ||
    (xApp === "cli" && userAgent.includes("claude"))
  ) {
    return { allowed: true, client: "claude_code" };
  }

  // ── OpenCode ─────────────────────────────────────────────────────────────
  // Default UA shape: opencode/<version> ...
  // originator: opencode
  if (
    userAgent.includes("opencode") ||
    originator === "opencode" ||
    originator.includes("opencode") ||
    headerValue(headers, "x-opencode").length > 0
  ) {
    return { allowed: true, client: "opencode" };
  }

  // ── Zed (Zed editor AI / agent) ──────────────────────────────────────────
  // Observed traffic:
  //   originator: zed
  //   User-Agent: zed/<version> (Windows …; x86_64) unknown (zed; …)
  if (
    originator === "zed" ||
    originator.startsWith("zed/") ||
    originator.startsWith("zed_") ||
    userAgent.startsWith("zed/") ||
    /\bzed\//i.test(userAgent) ||
    /\(zed[;)\s]/i.test(userAgent)
  ) {
    return { allowed: true, client: "zed" };
  }

  return { allowed: false, client: null };
}

/**
 * Summarize request headers for ban audit logs (no secrets).
 */
export function summarizeClientHeaders(headers: Headers): Record<string, string | null> {
  const pick = (name: string): string | null => {
    const value = headerValue(headers, name);
    return value.length > 0 ? value.slice(0, 200) : null;
  };

  return {
    "user-agent": pick("user-agent"),
    originator: pick("originator"),
    "x-app": pick("x-app"),
    "x-client": pick("x-client"),
    "x-flixa-client": pick("x-flixa-client"),
    "anthropic-beta": pick("anthropic-beta"),
    "anthropic-version": pick("anthropic-version"),
    referer: pick("referer") || pick("http-referer"),
  };
}
