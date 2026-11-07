import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-colors [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-surface-39 text-foreground",
        secondary: "border-transparent bg-foreground/10 text-secondary-foreground",
        neutral: "border-transparent bg-foreground/10 text-secondary-foreground",
        destructive: "border-transparent bg-destructive-500/20 text-destructive-300",
        warning: "border-transparent bg-warning-500/20 text-warning-300",
        outline: "border-foreground/20 text-neutral-231",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const dotVariants: Record<string, string> = {
  default: "border-foreground/15 bg-transparent text-secondary-foreground",
  secondary: "border-foreground/15 bg-transparent text-secondary-foreground",
  neutral: "border-foreground/15 bg-transparent text-secondary-foreground",
  destructive: "border-foreground/15 bg-transparent text-secondary-foreground",
  warning: "border-foreground/15 bg-transparent text-secondary-foreground",
  outline: "border-foreground/15 bg-transparent text-secondary-foreground",
};

const dotColors: Record<string, string> = {
  default: "bg-muted-foreground",
  secondary: "bg-muted-foreground",
  neutral: "bg-muted-foreground",
  destructive: "bg-destructive-400",
  warning: "bg-warning-400",
  outline: "bg-muted-foreground",
};

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

function Badge({
  className,
  variant = "default",
  appearance,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { appearance?: "dot" }) {
  const resolvedVariant = variant as BadgeVariant;

  return (
    <span
      data-slot="badge"
      className={cn(
        appearance === "dot"
          ? cn(
              "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
              dotVariants[resolvedVariant],
            )
          : badgeVariants({ variant: resolvedVariant }),
        className,
      )}
      {...props}
    >
      {appearance === "dot" ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", dotColors[resolvedVariant])} />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
