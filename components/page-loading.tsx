"use client";

import { useExtracted } from "next-intl";
import { LoadingFallback } from "@/components/ui/loading";

export function PageLoading() {
  const t = useExtracted();
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <LoadingFallback label={t("Loading…")} />
    </div>
  );
}
