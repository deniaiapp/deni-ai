import { useExtracted } from "@/i18n/react";
import { useState } from "react";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppMark } from "./app-mark";

export function SetupScreen({ onReady }: { onReady: () => void }) {
  const t = useExtracted();
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
      if (!res.ok) throw new Error(t("Failed to save"));
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-6 py-16">
      <FadeIn className="w-full max-w-lg">
      <Card className="w-full p-6">
        <AppMark />
        <div className="mt-2">
          <h1 className="text-lg font-semibold text-foreground">
            {t("AI teammates.")}
            <br />
            {t("Their own computer.")}
          </h1>
        </div>
        <div className="mt-4">
          <p className="text-[0.925rem] text-muted-foreground">
            {t("Hand work to named teammates and let them finish it on an isolated computer (browser, files, and terminal). Your workspace stays private to your account.")}
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
          <p className="text-xs text-muted-foreground">
            {t("Get a key at openrouter.ai. Run uses anthropic/claude-sonnet-5.5; Run+ uses anthropic/claude-opus-5.5. Each mode counts tokens at 1× to 2.6×, shown in the mode menu. Pick a mode in the workspace. This screen is skipped when an environment variable is set.")}
          </p>
          {error ? <p className="text-xs text-destructive-400">{error}</p> : null}
        </div>
        <Button
          type="button"
          variant="primary"
          className="mt-6 w-full"
          disabled={!apiKey.trim() || busy}
          loading={busy}
          onClick={save}
        >
          {busy ? t("Connecting…") : t("Open workspace")}
        </Button>
      </Card>
      </FadeIn>
    </main>
  );
}
