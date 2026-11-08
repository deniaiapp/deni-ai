import { Menu } from "lucide-react";
import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { UserButton } from "@/components/auth/user/user-button";
import { localizedPath } from "@/lib/locale-path";
import DeniAIIcon from "./deni-ai-icon";
import { LocaleSwitcher } from "./locale-switcher";
import { buttonVariants } from "@deniai/ui/components/button-variants";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@deniai/ui/components/sheet";

/** Single-row header of the public pages: logo, a few links, language and account. */
export default function Header() {
  const t = useExtracted();
  const locale = useLocale();

  const links = [
    { href: "/chat", label: t("Chat") },
    { href: localizedPath("/flixa", locale), label: "Flixa" },
    { href: localizedPath("/desktop", locale), label: t("Desktop") },
    { href: localizedPath("/faq", locale), label: t("FAQ") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4 sm:px-6">
        <Link
          href={localizedPath("/home", locale)}
          className="flex shrink-0 items-center gap-2 text-sm font-semibold"
        >
          <DeniAIIcon className="size-6 text-foreground" />
          Deni AI
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <LocaleSwitcher />
          <UserButton size="icon" />
        </div>

        <Sheet>
          <SheetTrigger
            className={buttonVariants({
              variant: "ghost",
              size: "icon",
              className: "ml-auto md:hidden",
            })}
            aria-label={t("Open menu")}
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader className="border-b border-border">
              <SheetTitle>{t("Menu")}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
              <ul className="flex flex-col">
                {links.map((link) => (
                  <li key={link.href}>
                    <SheetClose
                      render={<Link href={link.href} />}
                      nativeButton={false}
                      className="block rounded-md px-2 py-2.5 text-sm hover:bg-accent"
                    >
                      {link.label}
                    </SheetClose>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">{t("Language")}</p>
                <LocaleSwitcher />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">{t("Account")}</p>
                <UserButton />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  );
}
