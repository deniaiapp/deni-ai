import Link from "next/link";
import { FadeIn } from "@/components/motion";

export default function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center bg-[#050505] px-6 text-center">
      <FadeIn className="flex flex-col items-center gap-3">
        <h1 className="text-lg font-semibold text-[#f0f0f0]">Page not found</h1>
        <p className="text-sm text-[#8f8f8f]">That URL is not part of Deni Run.</p>
        <Link
          href="/"
          className="rounded-lg bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#0a0a0a] transition-transform hover:bg-white active:scale-[0.98]"
        >
          Back home
        </Link>
      </FadeIn>
    </main>
  );
}
