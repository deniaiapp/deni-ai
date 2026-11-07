import { LoadingFallback } from "@/components/ui/loading";
import { useExtracted } from "@/i18n/react";

export function RouteLoading() {
  const t = useExtracted();
  return (
    <main className="flex h-full items-center justify-center bg-background">
      <LoadingFallback label={t("Loading…")} />
    </main>
  );
}
