import { Link } from "@tanstack/react-router";
import { FadeIn } from "@/components/motion";
import { useExtracted } from "@/i18n/react";

export function NotFound() {
  const t = useExtracted();
  return (
    <main className="flex h-full flex-col items-center justify-center bg-background px-6 text-center">
      <FadeIn className="flex flex-col items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("Page not found")}</h1>
        <p className="text-sm text-muted-foreground">{t("That URL is not part of Deni Run.")}</p>
        <Link
          to="/"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
        >
          {t("Back home")}
        </Link>
      </FadeIn>
    </main>
  );
}
