import { Bot, MessageSquare } from "lucide-react";
import { useExtracted } from "use-intl";
import { getAppMode } from "@/lib/app-mode";
import { Link, usePathname } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const itemClassName =
  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

/** Sidebar switch between chat mode and Run mode. */
export function AppModeSwitch() {
  const t = useExtracted();
  const mode = getAppMode(usePathname());

  return (
    <nav aria-label={t("App mode")} className="mb-4 flex gap-1 rounded-lg bg-sidebar-accent p-1">
      <Link
        href="/chat"
        aria-current={mode === "chat" ? "page" : undefined}
        className={cn(
          itemClassName,
          mode === "chat"
            ? "bg-background text-foreground shadow-sm"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground",
        )}
      >
        <MessageSquare className="size-4" />
        {t("Chat")}
      </Link>
      <Link
        href="/run"
        aria-current={mode === "run" ? "page" : undefined}
        className={cn(
          itemClassName,
          mode === "run"
            ? "bg-background text-foreground shadow-sm"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground",
        )}
      >
        <Bot className="size-4" />
        {t("Run")}
      </Link>
    </nav>
  );
}
