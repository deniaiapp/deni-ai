"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        id={id}
        aria-label={ariaLabel}
        type="button"
        disabled={disabled}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-foreground/15 bg-surface-input px-3 text-left text-sm text-foreground outline-none transition-colors hover:border-primary/40 focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] max-h-64 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-xl border border-foreground/10 bg-surface-raised p-1.5 text-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className="flex cursor-default items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-primary/15 data-[state=checked]:text-foreground"
              >
                <span className="truncate">{option.label}</span>
                <DropdownMenu.ItemIndicator><Check className="size-4 text-sidebar-primary" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
