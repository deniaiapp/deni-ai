import { useRouteContext } from "@tanstack/react-router";
import { Bot, MessageSquare } from "lucide-react";
import { useExtracted } from "use-intl";
import { getAppMode } from "@/lib/app-mode";
import { Link, usePathname } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const itemClassName =
  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-ring";

/**
 * Sidebar switch between chat mode and Run mode. The active mode is the
 * "on" colour (sidebar-primary) and carries aria-current. Hidden while Run is
 * switched off for the deployment (`RUN_ENABLED=false`).
 */
export function AppModeSwitch() {
  const t = useExtracted();
  const mode = getAppMode(usePathname());
  const runEnabled = useRouteContext({
    from: "/_app",
    select: (context) => context.authState.runEnabled,
  });
  if (!runEnabled) return null;

  return (
    <nav
      aria-label={t("App mode")}
      // Switching modes swaps the sidebar's content, so the mobile sheet stays
      // open (SIDEBAR_KEEP_OPEN_ATTRIBUTE in @/lib/mobile-sidebar).
      data-sidebar-keep-open=""
      className="flex gap-1 rounded-lg bg-sidebar-accent p-1 dark:bg-white/5"
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
              ? "shadow-xs bg-background text-foreground"
              : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-transparent",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
