"use client";

import { useEffect, useState } from "react";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const recover = retry ?? reset ?? (() => window.location.reload());
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex h-full flex-col items-center justify-center bg-[#050505] px-6 text-center">
      <FadeIn className="flex flex-col items-center gap-3">
        <h1 className="text-lg font-semibold text-[#f0f0f0]">Something went wrong</h1>
        <p className="max-w-md text-sm text-[#8f8f8f]">
          Reload this page. If it keeps happening, wait a moment and try again.
        </p>
        <Button
          type="button"
          variant="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            recover();
          }}
        >
          Try again
        </Button>
      </FadeIn>
    </main>
  );
}
