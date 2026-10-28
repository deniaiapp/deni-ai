import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PlanHighlightsProps = {
  items: ReactNode[];
  className?: string;
};

export function PlanHighlights({ items, className }: PlanHighlightsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((item, index) => (
        // Fixed per plan and never reordered, so the position is a stable key.
        <li key={index} className="flex items-start gap-2.5 text-sm font-medium">
          <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" strokeWidth={3} />
          </span>
          <span className="text-foreground/80">{item}</span>
        </li>
      ))}
    </ul>
  );
}
