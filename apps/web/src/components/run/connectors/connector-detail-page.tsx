import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, Plus } from "lucide-react";
import { useExtracted } from "use-intl";
import { mcpCatalogEntry, type McpCatalogId } from "@deniai/run/mcp/catalog";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import { Spinner } from "@deniai/ui/components/spinner";
import { Link } from "@/lib/navigation";
import { RunLoading, RunPage } from "../run-page";
import {
  useConnectorCategories,
  useConnectorDescriptions,
  useConnectorDetails,
} from "./connector-copy";
import { ConnectorLogoTile } from "./connector-logos";
import { useInstallConnector, useMcpState } from "./use-connectors";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/** `/run/connectors/$id`: what a connector does, how access works, and Install. */
export function ConnectorDetailPage({ id }: { id: string }) {
  const t = useExtracted();
  const entry = mcpCatalogEntry(id);
  const descriptions = useConnectorDescriptions();
  const categories = useConnectorCategories();
  const details = useConnectorDetails(id);
  const mcp = useMcpState();
  const install = useInstallConnector();

  const back = (
    <Button variant="ghost" size="sm" render={<Link href="/run/connectors" />} nativeButton={false}>
      <ArrowLeft className="size-4" />
      {t("All connectors")}
    </Button>
  );
  if (!entry) {
    return (
      <RunPage title={t("Connector not found")} actions={back}>
        <p className="text-sm text-muted-foreground">
          {t("This connector does not exist or is no longer available.")}
        </p>
      </RunPage>
    );
  }
  if (mcp.isLoading) return <RunLoading />;

  const name = entry.name;
  const connection = mcp.data?.connections.find((row) => row.catalogId === entry.id);
  const installing = install.isPending || install.isSuccess;

  return (
    <RunPage title={name} actions={back}>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <ConnectorLogoTile id={entry.id} size="lg" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{categories[entry.category]}</p>
            <p className="text-sm text-pretty">
              {details?.tagline ?? descriptions[entry.id as McpCatalogId]}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {connection ? (
            <>
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" />
                {connection.oauth === "signed-out" ? t("Signed out") : t("Installed")}
              </Badge>
              {connection.oauth === "signed-out" ? (
                <Button disabled={installing} onClick={() => install.mutate(entry.id)}>
                  {installing && <Spinner className="size-4" />}
                  {t("Sign in")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  render={<Link href="/run/settings" />}
                  nativeButton={false}
                >
                  {t("Manage")}
                </Button>
              )}
            </>
          ) : (
            <Button disabled={installing} onClick={() => install.mutate(entry.id)}>
              {installing ? <Spinner className="size-4" /> : <Plus className="size-4" />}
              {t("Install")}
            </Button>
          )}
        </div>
      </header>

      {details ? (
        <>
          <Section title={t("What your teammates can do")}>
            <ul className="list-disc space-y-1 pl-5">
              {details.can.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Section>
          <Section title={t("Example tasks")}>
            <ul className="grid gap-3 md:grid-cols-2">
              {details.examples.map((item) => (
                <li key={item} className="rounded-xl border bg-card p-4 text-foreground">
                  “{item}”
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}

      <Section title={t("How it works")}>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            {t(
              "Click Install. If {name} needs you to sign in, it asks you to allow access; Deni Run never sees your password.",
              { name },
            )}
          </li>
          <li>{t("Give any teammate a task that needs {name}.", { name })}</li>
        </ol>
        {details ? <p>{details.access}</p> : null}
      </Section>

      <Section title={t("You approve every change")}>
        <p>
          {t(
            "Tools that {name} marks as read-only, such as searching and reading, run without asking. Anything else, such as posting or editing, stops and shows you an approval card with what will be sent, and runs only after you approve it.",
            { name },
          )}
        </p>
        <p>
          {t(
            "In background runs that no one is watching, only read-only tools run and everything else is declined.",
          )}
        </p>
      </Section>

      <Section title={t("Your data")}>
        <p>
          {t(
            "Deni Run reads from {name} only to carry out a task you gave a teammate. Any sign-in tokens are stored encrypted and used only to call {name} for you. Remove the connector in Run settings to delete them right away.",
            { name },
          )}
        </p>
        {details ? <p>{details.revoke}</p> : null}
        <p>
          <a
            href={entry.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            {t("{name} documentation", { name })}
            <ArrowUpRight className="size-3.5" />
          </a>
        </p>
      </Section>
    </RunPage>
  );
}
