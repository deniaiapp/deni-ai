import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SettingsPageShellProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SettingsPageShell({
  title,
  description,
  actions,
  children,
  className,
}: SettingsPageShellProps) {
  // Left-aligned with the settings tabs above: centering a capped width put each
  // page's title at a different offset on wide screens (billing is wider).
  return (
    <div className={cn("flex w-full max-w-4xl flex-col gap-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
