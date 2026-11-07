import { useExtracted } from "@/i18n/react";
import { useEffect, useState, type ComponentProps } from "react";
import { CheckCircle2Icon, ChevronDownIcon, CircleAlertIcon, LayoutGridIcon, LogInIcon, PlugIcon, ShieldCheckIcon, TrashIcon, WrenchIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingFallback } from "@/components/ui/loading";
import { Select } from "@/components/ui/select";
import { authClient } from "@/lib/auth/client";
import { pluginWriteActions, type PluginKind } from "@/lib/mcp/plugin-actions";
import { mcpCatalog, type McpCatalogEntry } from "@/lib/mcp/catalog";
import { ConnectorGallery, useConnectorDescriptions } from "./connector-gallery";
import { ConnectorLogo } from "./connector-logos";
import { AppRow, AppRowMenu } from "./app-row";
import { DiscordRow, fetchDiscordStatus, type DiscordStatus } from "./discord-settings";
import { usePluginActionLabels } from "./plugin-action-labels";

type BuiltinPlugin = { kind: PluginKind; connected: boolean; writeAccess: boolean; alwaysAllow: string[] };
const builtinActions = pluginWriteActions;
const pluginLabels = { gmail: "Gmail", drive: "Google Drive", github: "GitHub" };
const pluginScopes = {
  gmail: { read: "https://www.googleapis.com/auth/gmail.readonly", write: "https://www.googleapis.com/auth/gmail.send" },
  drive: { read: "https://www.googleapis.com/auth/drive.readonly", write: "https://www.googleapis.com/auth/drive.file" },
  github: { read: "repo", write: "repo" },
};
import type { McpConnection } from "@/lib/types";

/** What the MCP OAuth callback reported in the URL when it sent the browser back. */
export type McpSignInReturn = { connectionId: string | null; error: string | null };
type McpTool = { name: string; description?: string; annotations?: { readOnlyHint?: boolean } };
type ToolList = { status: "loading" } | { status: "ready"; tools: McpTool[] } | { status: "error"; error: string };

// Stored errors are the server's English text; these mean the saved sign-in no longer works.
const authErrorPattern = /sign in|\b401\b|\b403\b|unauthori[sz]ed|invalid_token/i;

function needsSignIn(connection: McpConnection) {
  return connection.oauth === "signed-out" || (connection.lastError != null && authErrorPattern.test(connection.lastError));
}

/** A connection works once signed in, or once a server without sign-in passed a test. */
function isConnected(connection: McpConnection) {
  if (needsSignIn(connection)) return false;
  return connection.oauth === "signed-in" || (connection.oauth === null && connection.lastTestAt != null && connection.lastError == null);
}

/** The small button that opens an app's Always allow choices; it shows the current choice. */
function AlwaysAllowTrigger({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button type="button" size="xs" variant="ghost" className="min-w-0 max-w-40 gap-1 text-muted-foreground" title={label} aria-label={label} {...props}>
      <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {props.children}
      <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
    </Button>
  );
}

export function McpSettings({ open, onOpenChange, signInReturn = null, autoConnect = null, onAutoConnectStarted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signInReturn?: McpSignInReturn | null;
  /** Catalog id to start connecting once the dialog has loaded, as if Connect was clicked. */
  autoConnect?: string | null;
  onAutoConnectStarted?: () => void;
}) {
  const t = useExtracted();
  const connectorDescriptions = useConnectorDescriptions();
  const actionLabels = usePluginActionLabels();
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [plugins, setPlugins] = useState<BuiltinPlugin[]>([]);
  const [discord, setDiscord] = useState<DiscordStatus | null>(null);
  // Cards render together once the first load settles, so none of them pops in late.
  const [ready, setReady] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [transport, setTransport] = useState<"streamable-http" | "sse">("streamable-http");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [alwaysAllow, setAlwaysAllowMap] = useState<Record<string, string[]>>({});
  const [toolLists, setToolLists] = useState<Record<string, ToolList>>({});
  // Connector or connection id whose sign-in is starting, and connector errors by catalog id.
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [connectorErrors, setConnectorErrors] = useState<Record<string, string>>({});

  async function loadPlugins() {
    const res = await fetch("/api/plugins", { cache: "no-store" });
    if (res.ok) setPlugins(((await res.json()) as { plugins: BuiltinPlugin[] }).plugins);
  }

  async function loadDiscord() {
    setDiscord(await fetchDiscordStatus());
  }

  async function connect(kind: BuiltinPlugin["kind"], write: boolean) {
    const scopes = kind === "github" ? ["repo"] : [
      ...new Set([
        ...plugins.filter((plugin) => plugin.kind !== "github" && plugin.connected).flatMap((plugin) => [pluginScopes[plugin.kind].read, ...(plugin.writeAccess ? [pluginScopes[plugin.kind].write] : [])]),
        pluginScopes[kind].read,
        ...(write ? [pluginScopes[kind].write] : []),
      ]),
    ];
    const result = await authClient.linkSocial({
      provider: kind === "github" ? "github" : "google",
      scopes,
      callbackURL: `${window.location.origin}/?plugins=1`,
      ...(kind !== "github" ? { additionalParams: { access_type: "offline", prompt: "consent" } } : {}),
    });
    if (result.error) setMessage(result.error.message ?? t("Could not connect plugin."));
  }

  async function setAlwaysAllow(kind: BuiltinPlugin["kind"], action: string, enabled: boolean) {
    const res = await fetch("/api/plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, action, enabled }) });
    const data = await res.json();
    if (res.ok) setPlugins(data.plugins);
    else setMessage(data.error ?? t("Could not change permission."));
  }

  // None → ask every time, one → its name, some → first name plus a count, every action → all.
  function alwaysAllowSummary(plugin: BuiltinPlugin) {
    const actions = builtinActions[plugin.kind];
    const allowed = actions.filter((action) => plugin.alwaysAllow.includes(action));
    const [first] = allowed;
    if (!first) return t("Ask every time");
    const name = actionLabels[first] ?? first;
    if (allowed.length === 1) return name;
    if (allowed.length === actions.length) return t("All actions");
    return t("{action} +{count} more", { action: name, count: String(allowed.length - 1) });
  }

  async function disconnect(kind: BuiltinPlugin["kind"]) {
    const label = pluginLabels[kind];
    if (!window.confirm(t("Disconnect {plugin}? Teammates will lose access to it right away. You can connect it again later.", { plugin: label }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/plugins", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      const data = await res.json().catch(() => ({})) as { plugins?: BuiltinPlugin[]; error?: string };
      if (!res.ok || !data.plugins) throw new Error(data.error ?? t("Could not disconnect plugin."));
      setPlugins(data.plugins);
      setMessage(t("Disconnected {plugin}. Teammates can no longer use it.", { plugin: label }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const res = await fetch("/api/mcp", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { connections?: McpConnection[]; alwaysAllow?: Record<string, string[]> };
    const list = json.connections ?? [];
    setConnections(list);
    setAlwaysAllowMap(json.alwaysAllow ?? {});
    return list;
  }

  useEffect(() => {
    if (open) {
      // A dialog opening is the external event that requires refreshing the connection list.
      // eslint-disable-next-line react/set-state-in-effect
      const loaded = load();
      void Promise.allSettled([loaded, loadPlugins(), loadDiscord()]).then(async () => {
        setReady(true);
        if (signInReturn?.error) setNotice({ tone: "error", text: signInReturn.error });
        else if (signInReturn?.connectionId) {
          const connection = (await loaded.catch(() => null))?.find((item) => item.id === signInReturn.connectionId);
          setNotice({ tone: "success", text: connection ? t("Connected {name}.", { name: connection.name }) : t("Connected.") });
        } else setNotice(null);
        const entry = mcpCatalog.find((item) => item.id === autoConnect);
        if (entry) {
          // An "Add to …" link: start the connector's sign-in unless it already works.
          onAutoConnectStarted?.();
          const existing = (await loaded.catch(() => null))?.find((item) => item.catalogId === entry.id);
          if (existing && isConnected(existing)) setNotice({ tone: "success", text: t("{name} is already connected.", { name: existing.name }) });
          else await signIn({ catalogId: entry.id });
        }
      });
    }
    // Opening the dialog or a new sign-in return refreshes it; a new translator alone does not.
    // The connector to add arrives together with the dialog opening, so it is read here only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signInReturn]);

  /**
   * Start OAuth for a connector (adding it first) or an existing connection, then leave for the
   * sign-in page. Servers without sign-in are tested here instead, which finishes the connect.
   */
  async function signIn(target: { catalogId: string } | { id: string }): Promise<"leaving" | "done" | "failed"> {
    const key = "catalogId" in target ? target.catalogId : target.id;
    setSigningIn(key);
    setMessage(null);
    setNotice(null);
    if ("catalogId" in target) setConnectorErrors((current) => ({ ...current, [target.catalogId]: "" }));
    try {
      const res = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", ...target }) });
      const data = (await res.json().catch(() => ({}))) as { connection?: McpConnection; authorizeUrl?: string | null; error?: string };
      if (!res.ok || !data.connection) throw new Error(data.error || t("Could not start sign-in."));
      if (data.authorizeUrl) {
        // The server's sign-in page sends the browser back to /?plugins=1 when done.
        window.location.assign(data.authorizeUrl);
        return "leaving";
      }
      // No sign-in needed; check the server right away.
      setSigningIn(null);
      await test(data.connection.id);
      return "done";
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if ("catalogId" in target) setConnectorErrors((current) => ({ ...current, [target.catalogId]: text }));
      else setMessage(text);
      setSigningIn(null);
      await load();
      return "failed";
    }
  }

  /** Back to the Plugins dialog once a connector without sign-in is added, to show its result. */
  async function connectFromGallery(entry: McpCatalogEntry) {
    if ((await signIn({ catalogId: entry.id })) === "done") setGalleryOpen(false);
  }

  async function disconnectConnection(connection: McpConnection) {
    if (!window.confirm(t("Disconnect {plugin}? Teammates will lose access to it right away. You can connect it again later.", { plugin: connection.name }))) return;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: connection.id }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("Could not disconnect plugin."));
      setMessage(t("Disconnected {plugin}. Teammates can no longer use it.", { plugin: connection.name }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadTools(id: string) {
    const current = toolLists[id];
    if (current?.status === "ready") return;
    setToolLists((lists) => ({ ...lists, [id]: { status: "loading" } }));
    try {
      const res = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tools", id }) });
      const data = (await res.json().catch(() => ({}))) as { tools?: McpTool[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("Could not load tools."));
      setToolLists((lists) => ({ ...lists, [id]: { status: "ready", tools: Array.isArray(data.tools) ? data.tools : [] } }));
    } catch (error) {
      setToolLists((lists) => ({ ...lists, [id]: { status: "error", error: error instanceof Error ? error.message : String(error) } }));
    }
  }

  async function setToolAlwaysAllow(id: string, tool: string, enabled: boolean) {
    const res = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "always-allow", id, tool, enabled }) });
    const data = (await res.json().catch(() => ({}))) as { alwaysAllow?: string[]; error?: string };
    const next = data.alwaysAllow;
    if (res.ok && next) setAlwaysAllowMap((current) => ({ ...current, [id]: next }));
    else setMessage(data.error ?? t("Could not change permission."));
  }

  function toolAlwaysAllowSummary(id: string) {
    const [first, ...rest] = alwaysAllow[id] ?? [];
    if (!first) return t("Ask every time");
    if (rest.length === 0) return first;
    return t("{action} +{count} more", { action: first, count: String(rest.length) });
  }

  /**
   * Always allow for an MCP connection's tools. Connector servers are known, so their read-only
   * tools already run freely and only the others are listed; custom servers list every tool.
   */
  function toolAlwaysAllow(connection: McpConnection) {
    const trustsReadOnly = connection.catalogId != null;
    const list = toolLists[connection.id];
    const allowed = alwaysAllow[connection.id] ?? [];
    const tools = list?.status === "ready" ? list.tools.filter((tool) => !trustsReadOnly || tool.annotations?.readOnlyHint !== true) : [];
    return <DropdownMenu onOpenChange={(next) => { if (next) void loadTools(connection.id); }}>
        <DropdownMenuTrigger render={<AlwaysAllowTrigger label={t("Always allow tools for {name}", { name: connection.name })} />}>
          <span className="truncate">{toolAlwaysAllowSummary(connection.id)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[min(20rem,var(--available-height))] max-w-80">
          <DropdownMenuGroup>
            {/* Stays in view while a long list of tools scrolls under it. */}
            <DropdownMenuGroupLabel className="sticky -top-1 z-10 bg-surface-28">{t("Run without asking")}</DropdownMenuGroupLabel>
            {!list || list.status === "loading" ? <DropdownMenuLabel>{t("Loading tools…")}</DropdownMenuLabel>
              : list.status === "error" ? <DropdownMenuLabel className="text-destructive-300">{list.error}</DropdownMenuLabel>
              : tools.length === 0 ? <DropdownMenuLabel>{trustsReadOnly ? t("Every tool on this server is read-only.") : t("This server has no tools.")}</DropdownMenuLabel>
              : tools.map((tool) => <DropdownMenuCheckboxItem key={tool.name} checked={allowed.includes(tool.name)} onCheckedChange={(checked) => void setToolAlwaysAllow(connection.id, tool.name, checked)}>
                <span className="grid min-w-0"><span className="truncate font-mono text-xs">{tool.name}</span>{tool.description ? <span className="truncate text-xs text-muted-foreground">{tool.description}</span> : null}</span>
              </DropdownMenuCheckboxItem>)}
          </DropdownMenuGroup>
          {trustsReadOnly ? <DropdownMenuLabel className="mt-1 border-t border-foreground/10 pt-2">{t("Read-only tools already run without asking.")}</DropdownMenuLabel> : null}
        </DropdownMenuContent>
      </DropdownMenu>;
  }

  /** Always allow for a built-in plugin's write actions, in the same compact form. */
  function pluginAlwaysAllow(plugin: BuiltinPlugin) {
    return <DropdownMenu>
      <DropdownMenuTrigger render={<AlwaysAllowTrigger label={t("Always allow tools for {name}", { name: pluginLabels[plugin.kind] })} />}>
        <span className="truncate">{alwaysAllowSummary(plugin)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>{t("Run without asking")}</DropdownMenuGroupLabel>
          {builtinActions[plugin.kind].map((action) => <DropdownMenuCheckboxItem key={action} checked={plugin.alwaysAllow.includes(action)} onCheckedChange={(checked) => void setAlwaysAllow(plugin.kind, action, checked)}>{actionLabels[action] ?? action}</DropdownMenuCheckboxItem>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>;
  }

  const customConnections = connections.filter((connection) => connection.catalogId == null);
  // Connectors already added to this account, plus any whose connect just failed (from an
  // "Add to …" link, say) so the error stays visible here.
  const addedConnectors = mcpCatalog.filter((entry) => connections.some((item) => item.catalogId === entry.id) || connectorErrors[entry.id]);

  function connectorStatus(entry: McpCatalogEntry) {
    const connection = connections.find((item) => item.catalogId === entry.id);
    const error = connectorErrors[entry.id];
    if (error) return <span role="alert" className="text-destructive-300">{error}</span>;
    if (connection && isConnected(connection)) return <span className="text-muted-foreground">{t("Connected")}</span>;
    if (connection && needsSignIn(connection)) return <span className="text-warning-300">{t("Needs sign-in again")}</span>;
    return null;
  }

  function connectorAction(entry: McpCatalogEntry) {
    const connection = connections.find((item) => item.catalogId === entry.id);
    const again = connection != null && (isConnected(connection) || needsSignIn(connection));
    return <Button type="button" size="sm" variant={again ? "outline" : "primary"} loading={signingIn === entry.id} disabled={signingIn != null && signingIn !== entry.id} onClick={() => void connectFromGallery(entry)} aria-label={again ? t("Reconnect {name}", { name: entry.name }) : t("Connect {name}", { name: entry.name })}>
      {again ? t("Reconnect") : t("Connect")}
    </Button>;
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      let parsedHeaders: Record<string, string> = {};
      if (headers.trim()) parsedHeaders = JSON.parse(headers) as Record<string, string>;
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, transport, secret: secret || undefined, headers: parsedHeaders }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || t("Unable to save connection"));
      setName("");
      setUrl("");
      setSecret("");
      setHeaders("");
      setMessage(t("Connection saved. Test it before asking a teammate to call it."));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; tools?: unknown[] };
      if (!res.ok) throw new Error(json.error || t("MCP test failed"));
      setMessage(t("Connected. Discovered {count, plural, one {# tool} other {# tools}}.", { count: json.tools?.length ?? 0 }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh] overflow-auto">
        <DialogTitle className="flex items-center gap-2"><PlugIcon className="size-4" /> {t("Plugins")}</DialogTitle>
        <DialogDescription>{t("Connect built-in services for search and reading. Writing requires a separate approval unless you enable Always allow for that action.")}</DialogDescription>
        {ready ? <>
          {notice ? <Alert variant={notice.tone === "error" ? "destructive" : "default"} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.tone === "error" ? <CircleAlertIcon /> : <CheckCircle2Icon />}
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert> : null}
          <section aria-labelledby="mcp-connectors-heading" className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="mcp-connectors-heading" className="text-sm font-semibold">{t("Connectors")}</h3>
                <p className="text-xs text-muted-foreground">{t("Connect apps in one click. You sign in on their site; Deni Run never sees your password.")}</p>
              </div>
              <Button type="button" size="sm" variant="outline" icon={LayoutGridIcon} onClick={() => setGalleryOpen(true)}>{t("Browse connectors")}</Button>
            </div>
            {/* Built-in plugins, added connectors, and Discord share one compact list. */}
            <div className="divide-y divide-foreground/10 rounded-xl border border-foreground/10 bg-surface-raised">
              {plugins.map((plugin) => (
                <AppRow
                  key={plugin.kind}
                  logo={<ConnectorLogo id={plugin.kind} className="size-5" />}
                  name={pluginLabels[plugin.kind]}
                  status={plugin.connected ? t("Connected") : t("Not connected")}
                  actions={plugin.connected ? (
                    <>
                      {plugin.writeAccess ? pluginAlwaysAllow(plugin) : null}
                      <AppRowMenu
                        name={pluginLabels[plugin.kind]}
                        items={[
                          ...(!plugin.writeAccess && plugin.kind !== "github" ? [{ label: t("Enable write access"), onSelect: () => void connect(plugin.kind, true) }] : []),
                          { label: t("Reconnect"), onSelect: () => void connect(plugin.kind, false) },
                          { label: t("Disconnect"), destructive: true, disabled: busy, onSelect: () => void disconnect(plugin.kind) },
                        ]}
                      />
                    </>
                  ) : (
                    <Button type="button" size="xs" variant="primary" onClick={() => void connect(plugin.kind, false)}>{t("Connect")}</Button>
                  )}
                />
              ))}
              {addedConnectors.map((entry) => {
                const connection = connections.find((item) => item.catalogId === entry.id);
                const connected = connection ? isConnected(connection) : false;
                const expired = connection ? needsSignIn(connection) : false;
                const error = connectorErrors[entry.id];
                return (
                  <AppRow
                    key={entry.id}
                    logo={<ConnectorLogo id={entry.id} className="size-5" />}
                    name={<span title={connectorDescriptions[entry.id]}>{entry.name}</span>}
                    status={connected ? t("Connected") : expired ? t("Needs sign-in again") : t("Not connected")}
                    warn={expired}
                    actions={connected ? (
                      <>
                        {connection ? toolAlwaysAllow(connection) : null}
                        <AppRowMenu
                          name={entry.name}
                          items={[
                            { label: t("Reconnect"), disabled: signingIn != null, onSelect: () => void signIn({ catalogId: entry.id }) },
                            ...(connection ? [{ label: t("Disconnect"), destructive: true, disabled: busy, onSelect: () => void disconnectConnection(connection) }] : []),
                          ]}
                        />
                      </>
                    ) : (
                      <>
                        <Button type="button" size="xs" variant="primary" loading={signingIn === entry.id} disabled={signingIn != null && signingIn !== entry.id} onClick={() => void signIn({ catalogId: entry.id })} aria-label={expired ? t("Reconnect {name}", { name: entry.name }) : t("Connect {name}", { name: entry.name })}>
                          {expired ? t("Reconnect") : t("Connect")}
                        </Button>
                        {connection ? <AppRowMenu name={entry.name} items={[{ label: t("Disconnect"), destructive: true, disabled: busy, onSelect: () => void disconnectConnection(connection) }]} /> : null}
                      </>
                    )}
                  >
                    {error ? <p role="alert" className="mt-2 text-xs text-destructive-300">{error}</p> : null}
                  </AppRow>
                );
              })}
              {addedConnectors.length === 0 ? (
                <button type="button" onClick={() => setGalleryOpen(true)} className="block w-full px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/5">
                  {t("No connectors yet. Browse {count} apps such as Slack, Notion, Jira, and Sentry.", { count: String(mcpCatalog.length) })}
                </button>
              ) : null}
              <DiscordRow status={discord} onStatusChange={setDiscord} />
            </div>
          </section>
          {message ? <p className="text-sm text-secondary-foreground">{message}</p> : null}
          <Collapsible open={mcpOpen} onOpenChange={setMcpOpen} className="space-y-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm font-semibold hover:bg-foreground/5">
              <span>{t("Custom MCP servers")}{customConnections.length > 0 ? ` (${customConnections.length})` : ""}</span>
              <ChevronDownIcon className={`size-4 transition-transform ${mcpOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{t("Connect a streamable HTTP or SSE MCP server. Secrets are encrypted per account.")} {t("If the server uses OAuth, save it without a token and sign in.")}</p>
              <div className="grid gap-3 rounded-lg bg-foreground/5 p-3 ring-1 ring-foreground/10">
                <div className="grid gap-1.5"><Label htmlFor="mcp-name">{t("Name")}</Label><Input id="mcp-name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder={t("My tools")} /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-url">{t("Server URL")}</Label><Input id="mcp-url" value={url} onChange={(event) => setUrl(event.currentTarget.value)} placeholder="https://example.com/mcp" /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-transport">{t("Transport")}</Label><Select id="mcp-transport" value={transport} options={[{ value: "streamable-http", label: "Streamable HTTP" }, { value: "sse", label: "SSE" }]} onValueChange={(value) => setTransport(value as "streamable-http" | "sse")} disabled={busy} /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-secret">{t("Bearer token (optional)")}</Label><Input id="mcp-secret" type="password" value={secret} onChange={(event) => setSecret(event.currentTarget.value)} autoComplete="off" /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-headers">{t("Extra headers JSON (optional)")}</Label><Input id="mcp-headers" value={headers} onChange={(event) => setHeaders(event.currentTarget.value)} placeholder={'{"X-Workspace":"demo"}'} /></div>
                <Button type="button" onClick={() => void save()} loading={busy} disabled={!name.trim() || !url.trim()} icon={PlugIcon}>{t("Save connection")}</Button>
              </div>
              <div className="space-y-2">
                {customConnections.length === 0 ? <p className="text-sm text-muted-foreground">{t("No MCP connections yet.")}</p> : customConnections.map((connection) => {
                  const expired = needsSignIn(connection);
                  const auth = connection.oauth === "signed-in" ? t("Signed in with OAuth") : connection.oauth === "signed-out" ? t("Signed out") : connection.hasSecret ? t("Secret saved") : t("No secret");
                  return <div key={connection.id} className="space-y-3 rounded-lg bg-surface-raised p-3 ring-1 ring-foreground/10">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{connection.name}</p><p className="truncate font-mono text-xs text-muted-foreground">{connection.url}</p><p className="text-xs text-muted-foreground">{auth} · {connection.lastTestAt ? t("tested {time}", { time: connection.lastTestAt }) : t("not tested")}</p>
                        {expired ? <p className="text-xs text-warning-300">{t("Needs sign-in again")}</p> : connection.lastError ? <p className="truncate text-xs text-destructive-300" title={connection.lastError}>{t("Last test failed")}</p> : null}
                      </div>
                      {expired ? <Button type="button" size="xs" variant="primary" icon={LogInIcon} loading={signingIn === connection.id} disabled={signingIn != null && signingIn !== connection.id} onClick={() => void signIn({ id: connection.id })} aria-label={t("Sign in to {name}", { name: connection.name })}>{t("Sign in")}</Button>
                        : connection.oauth === null && !connection.hasSecret ? <Button type="button" size="xs" variant="outline" icon={LogInIcon} loading={signingIn === connection.id} disabled={signingIn != null && signingIn !== connection.id} onClick={() => void signIn({ id: connection.id })} aria-label={t("Sign in to {name} with OAuth", { name: connection.name })}>{t("Sign in with OAuth")}</Button> : null}
                      <Button type="button" size="xs" variant="outline" icon={WrenchIcon} loading={busy} onClick={() => void test(connection.id)}>{t("Test")}</Button>
                      <Button type="button" size="xs" variant="ghost" icon={TrashIcon} disabled={busy} onClick={() => void remove(connection.id)} aria-label={t("Delete {name}", { name: connection.name })} />
                    </div>
                    {isConnected(connection) ? toolAlwaysAllow(connection) : null}
                  </div>;
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </> : <LoadingFallback className="py-8" />}
      </DialogContent>
      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent size="lg" className="flex max-h-[85vh] flex-col overflow-hidden">
          <DialogTitle className="flex items-center gap-2"><LayoutGridIcon className="size-4" /> {t("Browse connectors")}</DialogTitle>
          <DialogDescription>{t("Connect apps in one click. You sign in on their site; Deni Run never sees your password.")}</DialogDescription>
          <div className="-mx-6 min-h-0 flex-1 overflow-auto px-6 pb-1">
            <ConnectorGallery
              autoFocus
              renderStatus={connectorStatus}
              renderAction={connectorAction}
              empty={<Button type="button" size="sm" variant="link" onClick={() => { setGalleryOpen(false); setMcpOpen(true); }}>{t("Add it as a custom MCP server")}</Button>}
            />
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
