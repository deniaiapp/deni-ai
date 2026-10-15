"use client";

import { useExtracted } from "next-intl";
import { useEffect, useState } from "react";
import { ChevronDownIcon, PlugIcon, TrashIcon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingFallback } from "@/components/ui/loading";
import { Select } from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { DiscordCard, fetchDiscordStatus, type DiscordStatus } from "./discord-settings";
import { usePluginActionLabels } from "./plugin-action-labels";

type BuiltinPlugin = { kind: "gmail" | "drive" | "github"; connected: boolean; writeAccess: boolean; alwaysAllow: string[] };
const builtinActions: Record<BuiltinPlugin["kind"], string[]> = {
  gmail: ["send"], drive: ["create", "update"], github: ["createIssue", "createPR", "comment"],
};
const pluginLabels = { gmail: "Gmail", drive: "Google Drive", github: "GitHub" };
const pluginScopes = {
  gmail: { read: "https://www.googleapis.com/auth/gmail.readonly", write: "https://www.googleapis.com/auth/gmail.send" },
  drive: { read: "https://www.googleapis.com/auth/drive.readonly", write: "https://www.googleapis.com/auth/drive.file" },
  github: { read: "repo", write: "repo" },
};
import type { McpConnection } from "@/lib/types";

export function McpSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useExtracted();
  const actionLabels = usePluginActionLabels();
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [plugins, setPlugins] = useState<BuiltinPlugin[]>([]);
  const [discord, setDiscord] = useState<DiscordStatus | null>(null);
  // Cards render together once the first load settles, so none of them pops in late.
  const [ready, setReady] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [transport, setTransport] = useState<"streamable-http" | "sse">("streamable-http");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    if (!res.ok) return;
    const json = (await res.json()) as { connections?: McpConnection[] };
    setConnections(json.connections ?? []);
  }

  useEffect(() => {
    if (open) {
      // A dialog opening is the external event that requires refreshing the connection list.
      // eslint-disable-next-line react/set-state-in-effect
      void Promise.allSettled([load(), loadPlugins(), loadDiscord()]).then(() => setReady(true));
    }
  }, [open]);

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
          <div className="grid gap-3">
            {plugins.map((plugin) => <div key={plugin.kind} className="rounded-xl border border-foreground/10 bg-surface-raised p-4">
              <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">{pluginLabels[plugin.kind]}</h3><p className="text-xs text-muted-foreground">{plugin.connected ? t("Connected · search and read") : t("Not connected")}</p></div>
                <Button type="button" size="sm" variant={plugin.connected ? "outline" : "primary"} onClick={() => void connect(plugin.kind, false)}>{plugin.connected ? t("Reconnect") : t("Connect")}</Button>
              </div>
              {plugin.connected ? <div className="mt-3 space-y-3 border-t border-foreground/10 pt-3">
                {!plugin.writeAccess && plugin.kind !== "github" ? <Button type="button" size="sm" variant="outline" onClick={() => void connect(plugin.kind, true)}>{t("Enable write access")}</Button> : null}
                {plugin.writeAccess ? <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("Always allow")}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="outline" className="min-w-0 max-w-64">
                        <span className="truncate">{plugin.alwaysAllow.length ? builtinActions[plugin.kind].filter((action) => plugin.alwaysAllow.includes(action)).map((action) => actionLabels[action] ?? action).join(", ") : t("Ask every time")}</span>
                        <ChevronDownIcon data-icon="inline-end" className="size-4 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{t("Run without asking")}</DropdownMenuLabel>
                      {builtinActions[plugin.kind].map((action) => <DropdownMenuCheckboxItem key={action} checked={plugin.alwaysAllow.includes(action)} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => void setAlwaysAllow(plugin.kind, action, checked)}>{actionLabels[action] ?? action}</DropdownMenuCheckboxItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div> : null}
                <div><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void disconnect(plugin.kind)}>{t("Disconnect")}</Button></div>
              </div> : null}
            </div>)}
            <DiscordCard status={discord} onStatusChange={setDiscord} />
          </div>
          {message ? <p className="text-sm text-secondary-foreground">{message}</p> : null}
          <Collapsible open={mcpOpen} onOpenChange={setMcpOpen} className="space-y-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm font-semibold hover:bg-foreground/5">
              <span>{t("Custom MCP servers")}{connections.length > 0 ? ` (${connections.length})` : ""}</span>
              <ChevronDownIcon className={`size-4 transition-transform ${mcpOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{t("Connect a streamable HTTP or SSE MCP server. Secrets are encrypted per account.")}</p>
              <div className="grid gap-3 rounded-lg bg-foreground/5 p-3 ring-1 ring-foreground/10">
                <div className="grid gap-1.5"><Label htmlFor="mcp-name">{t("Name")}</Label><Input id="mcp-name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder={t("My tools")} /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-url">{t("Server URL")}</Label><Input id="mcp-url" value={url} onChange={(event) => setUrl(event.currentTarget.value)} placeholder="https://example.com/mcp" /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-transport">{t("Transport")}</Label><Select id="mcp-transport" value={transport} options={[{ value: "streamable-http", label: "Streamable HTTP" }, { value: "sse", label: "SSE" }]} onValueChange={(value) => setTransport(value as "streamable-http" | "sse")} disabled={busy} /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-secret">{t("Bearer token (optional)")}</Label><Input id="mcp-secret" type="password" value={secret} onChange={(event) => setSecret(event.currentTarget.value)} autoComplete="off" /></div>
                <div className="grid gap-1.5"><Label htmlFor="mcp-headers">{t("Extra headers JSON (optional)")}</Label><Input id="mcp-headers" value={headers} onChange={(event) => setHeaders(event.currentTarget.value)} placeholder={'{"X-Workspace":"demo"}'} /></div>
                <Button type="button" onClick={() => void save()} loading={busy} disabled={!name.trim() || !url.trim()} icon={PlugIcon}>{t("Save connection")}</Button>
              </div>
              <div className="space-y-2">
                {connections.length === 0 ? <p className="text-sm text-muted-foreground">{t("No MCP connections yet.")}</p> : connections.map((connection) => (
                  <div key={connection.id} className="flex items-center gap-2 rounded-lg bg-surface-raised p-3 ring-1 ring-foreground/10">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{connection.name}</p><p className="truncate font-mono text-xs text-muted-foreground">{connection.url}</p><p className="text-xs text-muted-foreground">{connection.hasSecret ? t("Secret saved") : t("No secret")} · {connection.lastTestAt ? t("tested {time}", { time: connection.lastTestAt }) : t("not tested")}</p></div>
                    <Button type="button" size="xs" variant="outline" icon={WrenchIcon} loading={busy} onClick={() => void test(connection.id)}>{t("Test")}</Button>
                    <Button type="button" size="xs" variant="ghost" icon={TrashIcon} disabled={busy} onClick={() => void remove(connection.id)} aria-label={t("Delete {name}", { name: connection.name })} />
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </> : <LoadingFallback className="py-8" />}
      </DialogContent>
    </Dialog>
  );
}
