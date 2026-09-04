import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-colors [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#272727] text-[#f0f0f0]",
        secondary: "border-transparent bg-white/10 text-[#c8c8c8]",
        neutral: "border-transparent bg-white/10 text-[#c8c8c8]",
        destructive: "border-transparent bg-red-500/20 text-red-300",
        warning: "border-transparent bg-amber-500/20 text-amber-300",
        outline: "border-white/20 text-[#e7e7e7]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const dotVariants: Record<string, string> = {
  default: "border-white/15 bg-transparent text-[#c8c8c8]",
  secondary: "border-white/15 bg-transparent text-[#c8c8c8]",
  neutral: "border-white/15 bg-transparent text-[#c8c8c8]",
  destructive: "border-white/15 bg-transparent text-[#c8c8c8]",
  warning: "border-white/15 bg-transparent text-[#c8c8c8]",
  outline: "border-white/15 bg-transparent text-[#c8c8c8]",
};

const dotColors: Record<string, string> = {
  default: "bg-[#8f8f8f]",
  secondary: "bg-[#8f8f8f]",
  neutral: "bg-[#8f8f8f]",
  destructive: "bg-red-400",
  warning: "bg-amber-400",
  outline: "bg-[#8f8f8f]",
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
