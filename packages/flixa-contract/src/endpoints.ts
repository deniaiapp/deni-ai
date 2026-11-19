/**
 * Public Flixa endpoints. Agent API paths are relative to the agent API origin;
 * `deviceAuth` is on the Deni AI web app origin. In each list the first path is
 * canonical and the rest are aliases.
 */
export const FLIXA_ENDPOINTS = {
  chatCompletions: "/v1/agent/chat/completions",
  responses: "/v1/agent/responses",
  responsesCompact: "/v1/agent/responses/compact",
  messages: ["/v1/messages", "/v1/agent/messages", "/v1/agent/v1/messages"],
  models: ["/v1/models", "/v1/agent/models"],
  usage: ["/v1/deni/usage", "/v1/deni/billing-status"],
  /** Provider base URL probe (`GET` / `HEAD`): `{ "object": "agent", "status": "ok" }`. */
  agentProbe: "/v1/agent",
  health: "/health",
  /** Web app origin. */
  deviceAuth: "/api/device-auth",
} as const;
