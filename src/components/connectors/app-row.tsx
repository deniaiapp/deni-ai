import { useExtracted } from "@/i18n/react";
import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * One app in the Plugins list: logo, name, and a short status on one line, with its controls on
 * the right. Anything that needs more room (an error, a link code) goes underneath.
 */
export function AppRow({
  logo,
  name,
  status,
  warn = false,
  actions,
  children,
}: {
  logo: ReactNode;
  name: ReactNode;
  status?: ReactNode;
  warn?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-foreground/10">{logo}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          {status ? <p className={`truncate text-xs ${warn ? "text-warning-300" : "text-muted-foreground"}`}>{status}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export type AppRowMenuItem = { label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean };

/** Less frequent actions, such as reconnecting or disconnecting, behind a "…" button. */
export function AppRowMenu({ name, items }: { name: string; items: AppRowMenuItem[] }) {
  const t = useExtracted();
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={t("More actions for {name}", { name })} />}
      >
        <MoreHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.destructive ? "destructive" : "default"}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
