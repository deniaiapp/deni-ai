import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex w-full min-w-0 rounded-lg border border-white/15 bg-[#151515] px-3 py-2 text-sm text-[#f0f0f0] outline-none transition-colors placeholder:text-[#6d6d6d] selection:bg-white/20",
        "focus-visible:border-white/30",
        "disabled:pointer-events-none disabled:opacity-50",
        "field-sizing-content resize-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
