"use client";

import { useEffect, useState } from "react";
import { PlugIcon, TrashIcon, WrenchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { McpConnection } from "@/lib/types";

export function McpSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [transport, setTransport] = useState<"streamable-http" | "sse">("streamable-http");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      void load();
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
      if (!res.ok) throw new Error(json.error || "Unable to save connection");
      setName("");
      setUrl("");
      setSecret("");
      setHeaders("");
      setMessage("Connection saved. Test it before asking a teammate to call it.");
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
      if (!res.ok) throw new Error(json.error || "MCP test failed");
      setMessage(`Connected. Discovered ${json.tools?.length ?? 0} tool(s).`);
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
        <DialogTitle className="flex items-center gap-2"><PlugIcon className="size-4" /> MCP connections</DialogTitle>
        <DialogDescription>
          Connect a streamable HTTP or SSE MCP server. Secrets are encrypted per account and never returned here.
        </DialogDescription>
        <div className="grid gap-3 rounded-lg bg-foreground/5 p-3 ring-1 ring-foreground/10">
          <div className="grid gap-1.5"><Label htmlFor="mcp-name">Name</Label><Input id="mcp-name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="My tools" /></div>
          <div className="grid gap-1.5"><Label htmlFor="mcp-url">Server URL</Label><Input id="mcp-url" value={url} onChange={(event) => setUrl(event.currentTarget.value)} placeholder="https://example.com/mcp" /></div>
          <div className="grid gap-1.5"><Label htmlFor="mcp-transport">Transport</Label><select id="mcp-transport" value={transport} onChange={(event) => setTransport(event.currentTarget.value as "streamable-http" | "sse")} className="h-9 rounded-lg border border-foreground/15 bg-surface-input px-3 text-sm text-foreground"><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE</option></select></div>
          <div className="grid gap-1.5"><Label htmlFor="mcp-secret">Bearer token (optional)</Label><Input id="mcp-secret" type="password" value={secret} onChange={(event) => setSecret(event.currentTarget.value)} autoComplete="off" /></div>
          <div className="grid gap-1.5"><Label htmlFor="mcp-headers">Extra headers JSON (optional)</Label><Input id="mcp-headers" value={headers} onChange={(event) => setHeaders(event.currentTarget.value)} placeholder={'{"X-Workspace":"demo"}'} /></div>
          <Button type="button" onClick={() => void save()} loading={busy} disabled={!name.trim() || !url.trim()} icon={PlugIcon}>Save connection</Button>
        </div>
        {message ? <p className="text-sm text-secondary-foreground">{message}</p> : null}
        <div className="space-y-2">
          {connections.length === 0 ? <p className="text-sm text-muted-foreground">No MCP connections yet.</p> : connections.map((connection) => (
            <div key={connection.id} className="flex items-center gap-2 rounded-lg bg-surface-raised p-3 ring-1 ring-foreground/10">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{connection.name}</p><p className="truncate font-mono text-xs text-muted-foreground">{connection.url}</p><p className="text-xs text-muted-foreground">{connection.hasSecret ? "Secret saved" : "No secret"} · {connection.lastTestAt ? `tested ${connection.lastTestAt}` : "not tested"}</p></div>
              <Button type="button" size="xs" variant="outline" icon={WrenchIcon} loading={busy} onClick={() => void test(connection.id)}>Test</Button>
              <Button type="button" size="xs" variant="ghost" icon={TrashIcon} disabled={busy} onClick={() => void remove(connection.id)} aria-label={`Delete ${connection.name}`} />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
