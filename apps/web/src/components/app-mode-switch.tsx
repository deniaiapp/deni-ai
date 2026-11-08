import { Bot, MessageSquare } from "lucide-react";
import { useExtracted } from "use-intl";
import { getAppMode } from "@/lib/app-mode";
import { Link, usePathname } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const itemClassName =
  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-ring";

/**
 * Sidebar switch between chat mode and Run mode. The active mode is the
 * "on" colour (sidebar-primary) and carries aria-current.
 */
export function AppModeSwitch() {
  const t = useExtracted();
  const mode = getAppMode(usePathname());

  return (
    <nav
      aria-label={t("App mode")}
      className="flex gap-1 rounded-lg bg-black/15 p-1 ring-1 ring-sidebar-border ring-inset legacy:bg-sidebar-accent legacy:ring-0 dark:bg-white/5"
    >
      {(
        [
          { value: "chat", href: "/chat", label: t("Chat"), icon: MessageSquare },
          { value: "run", href: "/run", label: t("Run"), icon: Bot },
        ] as const
      ).map(({ value, href, label, icon: Icon }) => (
        <Link
          key={value}
          href={href}
          aria-current={mode === value ? "page" : undefined}
          className={cn(
            itemClassName,
            mode === value
              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-xs legacy:bg-background legacy:text-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground legacy:hover:bg-transparent",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
