import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-lg border border-white/15 bg-[#151515] px-3 py-1 text-sm text-[#f0f0f0] outline-none transition-colors placeholder:text-[#6d6d6d] selection:bg-white/20",
        "focus-visible:border-white/30",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-invalid:border-red-500/60",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
