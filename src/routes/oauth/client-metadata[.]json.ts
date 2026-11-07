import { createFileRoute } from "@tanstack/react-router";
import { clientMetadataDocument } from "@/lib/mcp/oauth";
import { oauthBaseUrl } from "@/lib/site";

/** Client ID metadata document: MCP authorization servers fetch this URL as our client ID. */
export const Route = createFileRoute("/oauth/client-metadata.json")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Response.json(clientMetadataDocument(oauthBaseUrl() || new URL(request.url).origin), {
          headers: { "Cache-Control": "public, max-age=3600" },
        }),
    },
  },
});
