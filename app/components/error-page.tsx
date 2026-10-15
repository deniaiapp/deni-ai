import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { useExtracted } from "@/i18n/react";

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const t = useExtracted();
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex h-full flex-col items-center justify-center bg-background px-6 text-center">
      <FadeIn className="flex flex-col items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("Something went wrong")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("Reload this page. If it keeps happening, wait a moment and try again.")}
        </p>
        <Button
          type="button"
          variant="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            // Re-run the loaders, then render the route again.
            void router.invalidate().finally(() => {
              setBusy(false);
              reset();
            });
          }}
        >
          {t("Try again")}
        </Button>
      </FadeIn>
    </main>
  );
}
