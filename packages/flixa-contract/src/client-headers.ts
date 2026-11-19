/**
 * Client identification. On the Free and Go plans the agent API only serves
 * requests from known clients (services/agent-api `utils/deni/clientSignal.ts`);
 * Plus and above may use any client. Without a recognized client, Free/Go
 * requests get 403 `missing_client_signal` (or `client_update_required` for
 * `ai/` / `ai-sdk` User-Agents).
 */
export const KNOWN_CLIENTS = [
  "codex",
  "claude_code",
  "opencode",
  "zed",
  "flixa",
  "flixa_cli",
] as const;
export type KnownClient = (typeof KNOWN_CLIENTS)[number];

/** Headers the agent API reads to identify the client (case-insensitive). */
export const CLIENT_IDENTIFICATION_HEADERS = [
  "user-agent",
  "originator",
  "x-app",
  "x-client",
  "x-flixa-client",
  /** First-party shared secret, when the server sets `FLIXA_CLIENT_SIGNAL_SECRET`. */
  "x-flixa-signal",
  "x-opencode",
  "anthropic-beta",
  "anthropic-version",
  "referer",
  "http-referer",
] as const;
export type ClientIdentificationHeader = (typeof CLIENT_IDENTIFICATION_HEADERS)[number];

/**
 * Headers the Flixa CLI sends. Any one of them identifies it; sending all keeps
 * logs and admin lookups unambiguous.
 */
export function flixaCliClientHeaders(version: string): Record<string, string> {
  return {
    "user-agent": `flixa-cli/${version}`,
    "x-client": "flixa-cli",
    "x-flixa-client": `cli/${version}`,
    originator: "flixa-cli",
  };
}

/** Headers the Flixa VS Code extension sends. */
export function flixaExtensionClientHeaders(version: string): Record<string, string> {
  return {
    "user-agent": `flixa-vscode/${version}`,
    "x-client": "flixa-vscode",
    "x-flixa-client": `vscode/${version}`,
  };
}
