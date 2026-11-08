import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useExtracted } from "@/i18n/react";
import { LanguageSwitcher } from "../common/language-switcher";

/** Header and footer shared by the public support and integrations pages. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const t = useExtracted();
  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <header className="deni-rise mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="text-[0.925rem] font-semibold">
          Deni Run
        </Link>
        <nav aria-label={t("Main")} className="flex items-center gap-3 text-sm">
          <Link to="/integrations" className="text-muted-foreground hover:text-foreground">
            {t("Integrations")}
          </Link>
          <Link to="/support" className="text-muted-foreground hover:text-foreground">
            {t("Support")}
          </Link>
          <LanguageSwitcher />
        </nav>
      </header>
      {children}
      <PublicFooter />
    </main>
  );
}

export function PublicFooter() {
  const t = useExtracted();
  return (
    <footer className="border-t border-foreground/10 px-6 py-8 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap gap-4">
        <span>Deni Run</span>
        <Link to="/integrations" className="hover:text-foreground">
          {t("Integrations")}
        </Link>
        <Link to="/support" className="hover:text-foreground">
          {t("Support")}
        </Link>
        <Link to="/privacy" className="hover:text-foreground">
          {t("Privacy Policy")}
        </Link>
        <Link to="/terms" className="hover:text-foreground">
          {t("Terms")}
        </Link>
      </div>
    </footer>
  );
}
