import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const emptySizes = {
  sm: { root: "gap-2 py-6", icon: "size-8", title: "text-sm", description: "text-xs" },
  md: { root: "gap-3 py-10", icon: "size-12", title: "text-base", description: "text-sm" },
};

function Empty({
  className,
  icon,
  title,
  description,
  size = "md",
  ...props
}: ComponentProps<"div"> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof emptySizes;
}) {
  const styles = emptySizes[size];

  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        styles.root,
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className={cn("flex items-center justify-center", styles.icon)}>{icon}</div>
      ) : null}
      <div className={cn("font-medium text-[#f0f0f0]", styles.title)}>{title}</div>
      {description ? (
        <div className={cn("max-w-sm text-[#8f8f8f]", styles.description)}>{description}</div>
      ) : null}
    </div>
  );
}

export { Empty };
