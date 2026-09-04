"use client";

import { useState } from "react";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetupScreen({ onReady }: { onReady: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-[#050505] px-6 py-16">
      <FadeIn className="w-full max-w-lg">
      <Card className="w-full p-6">
        <span className="text-sm text-[#8f8f8f]">Deni Run</span>
        <div className="mt-2">
          <h1 className="text-lg font-semibold text-[#f0f0f0]">
            AI teammates.
            <br />
            Their own computer.
          </h1>
        </div>
        <div className="mt-4">
          <p className="text-[0.925rem] text-[#8f8f8f]">
            Hand work to named teammates and let them finish it on an isolated computer (browser,
            files, and terminal). Your workspace stays private to your account.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-1.5">
          <Label htmlFor="apiKey">OPENROUTER_API_KEY</Label>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder="sk-or-v1-..."
            autoComplete="off"
            data-1p-ignore
            aria-invalid={error ? true : undefined}
          />
          <p className="text-xs text-[#8f8f8f]">
            Get a key at openrouter.ai. Uses openai/gpt-5.6-luna. Pick Default, High, xhigh, or Max
            in the workspace. This screen is skipped when an environment variable is set.
          </p>
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>
        <Button
          type="button"
          variant="primary"
          className="mt-6 w-full"
          disabled={!apiKey.trim() || busy}
          loading={busy}
          onClick={save}
        >
          {busy ? "Connecting…" : "Open workspace"}
        </Button>
      </Card>
      </FadeIn>
    </main>
  );
}
