import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-[#f0f0f0] text-[#0a0a0a] hover:bg-white",
        secondary: "bg-white/10 text-[#f0f0f0] hover:bg-white/15",
        "secondary-destructive": "bg-red-500/15 text-red-300 hover:bg-red-500/25",
        outline: "border border-white/15 bg-transparent text-[#f0f0f0] hover:bg-white/5",
        ghost: "bg-transparent text-[#c8c8c8] hover:bg-white/5 hover:text-[#f0f0f0]",
        destructive: "bg-red-600 text-white hover:bg-red-500",
      },
      size: {
        xs: "h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3.5",
        sm: "h-8 px-3 text-sm [&_svg]:size-4",
        md: "h-9 px-4 text-sm [&_svg]:size-4",
      },
      shape: {
        default: "",
        square: "aspect-square p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "sm",
      shape: "default",
    },
  },
);

type IconComponent = React.ComponentType<{ size?: number | string; className?: string }>;

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    icon?: IconComponent;
    loading?: boolean;
  };

function Button({
  className,
  variant,
  size,
  shape,
  asChild = false,
  icon: Icon,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, shape, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2Icon className="animate-spin" /> : Icon ? <Icon /> : null}
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
