"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const t = useExtracted();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label={t("Toggle light and dark theme")}
      title={t("Toggle light and dark theme")}
      className="fixed right-4 bottom-4 z-50 flex size-9 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-lg transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon aria-hidden="true" className="hidden size-4 dark:block" />
      <MoonIcon aria-hidden="true" className="size-4 dark:hidden" />
    </button>
  );
}
