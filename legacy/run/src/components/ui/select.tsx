import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

export function Select({ id, ariaLabel, value, options, onValueChange, disabled, className, placeholder = "Select an option" }: {
  id?: string;
  ariaLabel?: string;
  value: string;
  options: Option[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <SelectPrimitive.Root
      items={options}
      value={selected ? value : null}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-foreground/15 bg-surface-input px-3 text-left text-sm text-foreground outline-none transition-colors hover:border-primary/40 focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20 data-disabled:cursor-not-allowed data-disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          align="start"
          sideOffset={6}
          collisionPadding={8}
          alignItemWithTrigger={false}
          className="z-[70] outline-none"
        >
          <SelectPrimitive.Popup className="max-h-64 min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border border-foreground/10 bg-surface-raised p-1.5 text-foreground shadow-xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0">
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="flex cursor-default items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors data-highlighted:bg-primary/15 data-selected:text-foreground"
                >
                  <SelectPrimitive.ItemText className="truncate">{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator><Check className="size-4 text-sidebar-primary" /></SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
