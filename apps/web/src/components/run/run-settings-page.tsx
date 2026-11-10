import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LayoutGrid, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import { Switch } from "@deniai/ui/components/switch";
import { Link, useRouter, useSearchParams } from "@/lib/navigation";
import { ConnectorLogoTile } from "./connectors/connector-logos";
import { useMcpState } from "./connectors/use-connectors";
import { runFetch, runKeys } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { RunLoading, RunPage } from "./run-page";

function McpSection() {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const mcp = useMcpState();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      runFetch<{ authorizeUrl?: string | null; tools?: unknown[] }>("mcp", { body }),
    onSuccess: async (result, body) => {
      if (body.action === "connect" && result.authorizeUrl) {
        window.location.assign(result.authorizeUrl);
        return;
      }
      if (body.action === "test")
        toast.success(
          t("Connected. {count} tools found.", { count: String(result.tools?.length ?? 0) }),
        );
      if (!body.action) {
        setName("");
        setUrl("");
        setSecret("");
      }
      await mcp.refetch();
    },
    onError: (error) => toast.error(errorText(error)),
  });
  if (mcp.isLoading) return <RunLoading />;
  const data = mcp.data;
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>{t("Connectors (MCP)")}</CardTitle>
          <CardDescription>
            {t(
              "Connect remote MCP servers. Teammates ask for approval before using a tool unless you always allow it.",
            )}
          </CardDescription>
        </div>
        <Button className="shrink-0" render={<Link href="/run/connectors" />} nativeButton={false}>
          <LayoutGrid className="size-4" />
          {t("Browse connectors")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {data?.connections.length ? (
          <ul className="divide-y rounded-lg border">
            {data.connections.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {connection.catalogId ? (
                    <Link href={`/run/connectors/${connection.catalogId}`} className="shrink-0">
                      <ConnectorLogoTile id={connection.catalogId} />
                    </Link>
                  ) : null}
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {connection.name}
                      {connection.oauth === "signed-out" ? (
                        <Badge variant="outline">{t("Signed out")}</Badge>
                      ) : null}
                      {connection.lastError ? (
                        <Badge variant="destructive">{t("Error")}</Badge>
                      ) : null}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {connection.url}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={connection.enabled}
                    aria-label={t("Enabled")}
                    onCheckedChange={(checked) =>
                      action.mutate({
                        action: "enable",
                        id: connection.id,
                        enabled: Boolean(checked),
                      })
                    }
                  />
                  {connection.oauth ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => action.mutate({ action: "connect", id: connection.id })}
                    >
                      {t("Sign in")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => action.mutate({ action: "test", id: connection.id })}
                  >
                    {t("Test")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("Delete")}
                    onClick={() => action.mutate({ action: "delete", id: connection.id })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("No connectors yet.")}</p>
        )}

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate({ name, url, secret: secret || undefined });
          }}
        >
          <h3 className="text-sm font-medium">{t("Custom server")}</h3>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="mcp-name">{t("Name")}</FieldLabel>
              <Input id="mcp-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-url">{t("URL")}</FieldLabel>
              <Input
                id="mcp-url"
                type="url"
                value={url}
                placeholder="https://example.com/mcp"
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="mcp-secret">{t("Bearer token (optional)")}</FieldLabel>
              <Input
                id="mcp-secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <div className="flex justify-end">
            <Button type="submit" disabled={!name.trim() || !url.trim() || action.isPending}>
              {t("Add server")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type DiscordState = {
  configured: boolean;
  inviteUrl: string | null;
  link: { username: string; linkedAt: string } | null;
};

function DiscordSection() {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const discord = useQuery({
    queryKey: runKeys.discord,
    queryFn: () => runFetch<DiscordState>("discord"),
  });
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const create = useMutation({
    mutationFn: () => runFetch<{ code: string; expiresAt: string }>("discord", { body: {} }),
    onSuccess: setCode,
    onError: (error) => toast.error(errorText(error)),
  });
  const unlink = useMutation({
    mutationFn: () => runFetch("discord", { method: "DELETE" }),
    onSuccess: () => discord.refetch(),
    onError: (error) => toast.error(errorText(error)),
  });
  const data = discord.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Discord")}</CardTitle>
        <CardDescription>{t("Talk to your teammates in Discord direct messages.")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!data ? null : !data.configured ? (
          <p className="text-muted-foreground">{t("Discord is not set up on this server.")}</p>
        ) : data.link ? (
          <div className="flex items-center justify-between gap-3">
            <span>{t("Linked as {name}", { name: data.link.username })}</span>
            <Button size="sm" variant="outline" onClick={() => unlink.mutate()}>
              {t("Unlink")}
            </Button>
          </div>
        ) : (
          <>
            {data.inviteUrl ? (
              <p>
                <a className="underline" href={data.inviteUrl} target="_blank" rel="noreferrer">
                  {t("Add the Deni Run bot to Discord")}
                </a>
              </p>
            ) : null}
            {code ? (
              <p>
                {t("Send this code to the bot in a direct message:")}{" "}
                <span className="font-mono text-base font-semibold">{code.code}</span>
              </p>
            ) : null}
            <div>
              <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
                {code ? t("New link code") : t("Create link code")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** `/run/settings`: MCP connectors and the Discord link. */
export function RunSettingsPage() {
  const t = useExtracted();
  const search = useSearchParams();
  const { replace } = useRouter();
  const connected = search.get("mcp");
  const failed = search.get("mcpError");
  useEffect(() => {
    if (!connected && !failed) return;
    if (connected) toast.success(t("Connector signed in."));
    if (failed) toast.error(failed);
    replace("/run/settings");
  }, [connected, failed, replace, t]);
  return (
    <RunPage title={t("Run settings")}>
      <McpSection />
      <DiscordSection />
    </RunPage>
  );
}
