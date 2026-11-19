import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { runFetch, runKeys, type McpConnection } from "../run-api";
import { useRunErrorText } from "../run-error-text";

export type McpState = {
  connections: McpConnection[];
  alwaysAllow: Record<string, Record<string, boolean>>;
};

/** The user's MCP connections; shared by Run settings and the connector gallery. */
export function useMcpState() {
  return useQuery({ queryKey: runKeys.mcp, queryFn: () => runFetch<McpState>("mcp") });
}

/**
 * Adds a catalog connector. Connectors that sign in with OAuth leave for the provider and
 * come back to Run settings; the rest are added in place.
 */
export function useInstallConnector() {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const mcp = useMcpState();
  return useMutation({
    mutationFn: (catalogId: string) =>
      runFetch<{ authorizeUrl?: string | null }>("mcp", {
        body: { action: "connect", catalogId },
      }),
    onSuccess: async (result) => {
      if (result.authorizeUrl) {
        window.location.assign(result.authorizeUrl);
        return;
      }
      toast.success(t("Connector added."));
      await mcp.refetch();
    },
    onError: (error) => toast.error(errorText(error)),
  });
}
