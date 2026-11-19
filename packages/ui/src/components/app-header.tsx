import * as React from "react";
import { cn } from "cn";

/**
 * The header bar at the top of the app sheet: sidebar trigger, page title and
 * actions. Sticky so the trigger stays reachable on mobile.
 */
function AppHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="app-header"
      className={cn(
        "sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-sm md:px-4",
        className,
      )}
      {...props}
    />
  );
}

function AppHeaderTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-header-title"
      className={cn("min-w-0 flex-1 truncate text-sm font-medium", className)}
      {...props}
    />
  );
}

function AppHeaderActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-header-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

export { AppHeader, AppHeaderActions, AppHeaderTitle };
