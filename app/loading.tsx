"use client";

import { useExtracted } from "next-intl";
import { LoadingFallback } from "@/components/ui/loading";

export default function Loading() {
  const t = useExtracted();
  return (
    <main className="flex h-full items-center justify-center bg-background">
      <LoadingFallback label={t("Loading…")} />
    </main>
  );
}
