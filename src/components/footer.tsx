import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { localizedPath } from "@/lib/locale-path";
import DeniAIIcon from "./deni-ai-icon";

const Footer = () => {
  const t = useExtracted();
  const locale = useLocale();
  const hrefFor = (path: string) => localizedPath(path, locale);

  const productLinks = [
    { href: "/home", label: "Deni AI" },
    { href: "/models", label: t("Models") },
    { href: "/desktop", label: t("Desktop") },
    { href: "/flixa", label: "Flixa" },
  ];

  const resourceLinks = [
    { href: "/guides", label: t("AI Guides") },
    { href: "/use-cases", label: t("Use Cases") },
    { href: "/faq", label: t("FAQ") },
    { href: "/changelog", label: t("Changelog") },
    { href: "/about", label: t("About") },
    { href: "/contact", label: t("Contact") },
  ];

  const legalLinks = [
    { href: "/legal/terms", label: t("Terms") },
    { href: "/legal/privacy-policy", label: t("Privacy") },
    { href: "/legal/tokusho", label: t("特定商取引法") },
  ];

  return (
    <footer className="relative border-t border-border/40 bg-card/50">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background to-transparent" />

      <div className="relative mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <DeniAIIcon className="size-8 text-primary" />
              <div>
                <span className="font-semibold tracking-tight">Deni AI</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("AI for Everyone")}</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
              {t(
                "A multi-model AI chat workspace with public guides on model choice, verification, privacy, and practical everyday use.",
              )}
            </p>
            <a
              href="mailto:contact@deniai.app"
              className="mt-4 inline-flex text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              contact@deniai.app
            </a>
          </div>

          <nav aria-label={t("Product")}>
            <p className="mb-3 text-sm font-medium">{t("Product")}</p>
            <ul className="space-y-2 text-sm">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={hrefFor(link.href)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t("Resources")}>
            <p className="mb-3 text-sm font-medium">{t("Resources")}</p>
            <ul className="space-y-2 text-sm">
              {resourceLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={hrefFor(link.href)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t("Legal")}>
            <p className="mb-3 text-sm font-medium">{t("Legal")}</p>
            <ul className="space-y-2 text-sm">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={hrefFor(link.href)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 border-t border-border/40 pt-6">
          <p className="text-center text-xs text-muted-foreground md:text-left">
            {t("© 2026 Deni AI team. All rights reserved.")}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
