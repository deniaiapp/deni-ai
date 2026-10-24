/**
 * Remote MCP servers that can be added with one click. Each signs in with OAuth; servers
 * without dynamic client registration name the environment variables of the client to use.
 */
export type McpCatalogEntry = {
  id: string;
  name: string;
  url: string;
  docsUrl: string;
  /** Pre-registered OAuth client, read from these environment variables on the server. */
  clientEnv?: { id: string; secret: string };
  /** Scopes to request instead of what the server advertises. */
  scope?: string;
};

export const mcpCatalog = [
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", docsUrl: "https://developers.notion.com/docs/mcp" },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", docsUrl: "https://linear.app/docs/mcp" },
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    docsUrl: "https://docs.slack.dev/ai/mcp-server",
    clientEnv: { id: "SLACK_MCP_CLIENT_ID", secret: "SLACK_MCP_CLIENT_SECRET" },
    // Must match the user token scopes of the Slack app; the server advertises more than we
    // ask for (users:read.email is left out for Marketplace review).
    scope: [
      "search:read.public", "search:read.private", "search:read.mpim", "search:read.im", "search:read.files", "search:read.users",
      "channels:history", "groups:history", "mpim:history", "im:history",
      "channels:read", "groups:read", "im:read", "mpim:read",
      "channels:write", "groups:write", "im:write", "mpim:write",
      "chat:write", "files:read", "files:write", "canvases:read", "canvases:write",
      "lists:read", "lists:write", "reactions:read", "reactions:write", "users:read", "emoji:read",
    ].join(" "),
  },
] as const satisfies readonly McpCatalogEntry[];

export type McpCatalogId = (typeof mcpCatalog)[number]["id"];

export const mcpCatalogEntry = (id: string | null | undefined): McpCatalogEntry | undefined =>
  mcpCatalog.find((entry) => entry.id === id);
