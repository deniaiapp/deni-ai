import Link from "next/link";
import { FadeIn } from "@/components/motion";

export default function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center bg-background px-6 text-center">
      <FadeIn className="flex flex-col items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">That URL is not part of Deni Run.</p>
        <Link
          href="/"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
        >
          Back home
        </Link>
      </FadeIn>
    </main>
  );
}
