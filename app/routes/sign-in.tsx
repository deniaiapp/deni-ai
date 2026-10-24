import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useExtracted } from "@/i18n/react";
import { redirectSignedIn } from "@/lib/auth-redirects";
import { connectorId, savePendingConnect } from "@/lib/connect-intent";
import { mcpCatalogEntry } from "@/lib/mcp-catalog";
import { SocialAuth } from "../components/auth-form";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { error?: string; connect?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
    connect: connectorId(search.connect) ?? undefined,
  }),
  beforeLoad: () => redirectSignedIn(),
  component: SignInPage,
});

function SignInPage() {
  const t = useExtracted();
  const { error, connect } = Route.useSearch();
  const connector = mcpCatalogEntry(connect);
  // Every sign-in path ends on "/", where the workspace picks this up and starts the connection.
  useEffect(() => {
    if (connect) savePendingConnect(connect);
  }, [connect]);
  return (
    <SocialAuth
      title={connector ? t("Sign in to connect {name}", { name: connector.name }) : t("Sign in")}
      mode="sign-in"
      error={error}
    />
  );
}
