import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { localizedPath } from "@/lib/locale-path";
import { supportUrl } from "@/lib/support-url";
import { LocaleSwitcher } from "./locale-switcher";

const Footer = () => {
  const t = useExtracted();
  const locale = useLocale();

  const links = [
    { href: localizedPath("/faq", locale), label: t("FAQ") },
    { href: supportUrl(locale), label: t("Help Center") },
    { href: localizedPath("/changelog", locale), label: t("Changelog") },
    { href: localizedPath("/contact", locale), label: t("Contact") },
    { href: localizedPath("/legal/terms", locale), label: t("Terms") },
    { href: localizedPath("/legal/privacy-policy", locale), label: t("Privacy") },
    { href: localizedPath("/legal/tokusho", locale), label: t("特定商取引法") },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <nav aria-label={t("Footer")}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {t("© 2026 Deni AI team. All rights reserved.")}
          </p>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  );
};

export default Footer;
