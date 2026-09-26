import { LoadingFallback } from "@/components/ui/loading";

export default function Loading() {
  return (
    <main className="flex h-full items-center justify-center bg-background">
      <LoadingFallback label="Loading…" />
    </main>
  );
}
