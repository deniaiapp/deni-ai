/**
 * Remote MCP servers that can be added with one click. Each signs in with OAuth, or needs no
 * sign-in at all; servers without dynamic client registration name the environment variables of
 * the client to use. Every URL must speak streamable HTTP.
 */
export type McpCatalogCategory = "productivity" | "communication" | "design" | "sales" | "payments" | "developer";

export type McpCatalogEntry = {
  id: string;
  name: string;
  url: string;
  docsUrl: string;
  category: McpCatalogCategory;
  /** Other names people search for, such as the products a server covers. */
  keywords?: readonly string[];
  /** Pre-registered OAuth client, read from these environment variables on the server. */
  clientEnv?: { id: string; secret: string };
  /** Scopes to request instead of what the server advertises. */
  scope?: string;
};

export const mcpCatalog = [
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", docsUrl: "https://developers.notion.com/guides/mcp/overview", category: "productivity", keywords: ["wiki", "docs"] },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", docsUrl: "https://linear.app/docs/mcp", category: "productivity", keywords: ["issues", "projects"] },
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    docsUrl: "https://docs.slack.dev/ai/slack-mcp-server/",
    category: "communication",
    keywords: ["chat", "messages"],
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
  {
    id: "atlassian",
    name: "Atlassian",
    url: "https://mcp.atlassian.com/v1/mcp",
    docsUrl: "https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/",
    category: "productivity",
    keywords: ["jira", "confluence", "issues", "wiki"],
  },
  { id: "monday", name: "monday.com", url: "https://mcp.monday.com/mcp", docsUrl: "https://developer.monday.com/apps/docs/mondaycom-mcp-integration", category: "productivity", keywords: ["boards", "projects"] },
  { id: "clickup", name: "ClickUp", url: "https://mcp.clickup.com/mcp", docsUrl: "https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server", category: "productivity", keywords: ["tasks", "projects"] },
  { id: "airtable", name: "Airtable", url: "https://mcp.airtable.com/mcp", docsUrl: "https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server", category: "productivity", keywords: ["database", "spreadsheet"] },
  { id: "granola", name: "Granola", url: "https://mcp.granola.ai/mcp", docsUrl: "https://docs.granola.ai/help-center/sharing/integrations/mcp", category: "productivity", keywords: ["meetings", "notes", "transcripts"] },
  { id: "dropbox", name: "Dropbox", url: "https://mcp.dropbox.com/mcp", docsUrl: "https://help.dropbox.com/integrations/connect-dropbox-mcp-server", category: "productivity", keywords: ["files", "storage"] },
  { id: "zapier", name: "Zapier", url: "https://mcp.zapier.com/api/mcp/mcp", docsUrl: "https://docs.zapier.com/mcp/home", category: "productivity", keywords: ["automation", "workflows"] },
  { id: "intercom", name: "Intercom", url: "https://mcp.intercom.com/mcp", docsUrl: "https://developers.intercom.com/docs/guides/mcp", category: "communication", keywords: ["support", "tickets", "customers"] },
  { id: "canva", name: "Canva", url: "https://mcp.canva.com/mcp", docsUrl: "https://www.canva.com/help/mcp-agent-setup/", category: "design", keywords: ["graphics", "presentations"] },
  { id: "miro", name: "Miro", url: "https://mcp.miro.com/", docsUrl: "https://developers.miro.com/docs/miro-mcp", category: "design", keywords: ["whiteboard", "diagrams"] },
  { id: "webflow", name: "Webflow", url: "https://mcp.webflow.com/mcp", docsUrl: "https://developers.webflow.com/mcp/reference/overview", category: "design", keywords: ["website", "cms"] },
  { id: "wix", name: "Wix", url: "https://mcp.wix.com/mcp", docsUrl: "https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp", category: "design", keywords: ["website", "store"] },
  { id: "attio", name: "Attio", url: "https://mcp.attio.com/mcp", docsUrl: "https://docs.attio.com/mcp/overview", category: "sales", keywords: ["crm", "deals"] },
  { id: "close", name: "Close", url: "https://mcp.close.com/mcp", docsUrl: "https://help.close.com/integrations/close-mcp-server", category: "sales", keywords: ["crm", "leads"] },
  { id: "stripe", name: "Stripe", url: "https://mcp.stripe.com", docsUrl: "https://docs.stripe.com/mcp", category: "payments", keywords: ["billing", "invoices", "subscriptions"] },
  { id: "paypal", name: "PayPal", url: "https://mcp.paypal.com/mcp", docsUrl: "https://developer.paypal.com/ai-tools/mcp-server", category: "payments", keywords: ["invoices", "orders"] },
  { id: "square", name: "Square", url: "https://mcp.squareup.com/mcp", docsUrl: "https://developer.squareup.com/docs/mcp", category: "payments", keywords: ["orders", "catalog", "point of sale"] },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", docsUrl: "https://mcp.sentry.dev/", category: "developer", keywords: ["errors", "monitoring"] },
  { id: "supabase", name: "Supabase", url: "https://mcp.supabase.com/mcp", docsUrl: "https://supabase.com/docs/guides/ai-tools/mcp", category: "developer", keywords: ["database", "postgres"] },
  { id: "neon", name: "Neon", url: "https://mcp.neon.tech/mcp", docsUrl: "https://neon.com/docs/ai/neon-mcp-server", category: "developer", keywords: ["database", "postgres", "sql"] },
  { id: "cloudflare", name: "Cloudflare", url: "https://mcp.cloudflare.com/mcp", docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/", category: "developer", keywords: ["workers", "dns"] },
  { id: "posthog", name: "PostHog", url: "https://mcp.posthog.com/mcp", docsUrl: "https://posthog.com/docs/model-context-protocol", category: "developer", keywords: ["analytics", "feature flags"] },
  { id: "huggingface", name: "Hugging Face", url: "https://huggingface.co/mcp", docsUrl: "https://huggingface.co/docs/hub/agents-mcp", category: "developer", keywords: ["models", "datasets", "ai"] },
  { id: "context7", name: "Context7", url: "https://mcp.context7.com/mcp", docsUrl: "https://context7.com/docs/overview", category: "developer", keywords: ["documentation", "libraries"] },
  { id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", docsUrl: "https://docs.devin.ai/work-with-devin/deepwiki-mcp", category: "developer", keywords: ["github", "repositories", "documentation"] },
] as const satisfies readonly McpCatalogEntry[];

export type McpCatalogId = (typeof mcpCatalog)[number]["id"];

export const mcpCatalogEntry = (id: string | null | undefined): McpCatalogEntry | undefined =>
  mcpCatalog.find((entry) => entry.id === id);
