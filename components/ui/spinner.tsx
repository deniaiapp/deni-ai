import { Loader2Icon } from "lucide-react";
import { useExtracted } from "next-intl";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const spinnerSizes = {
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
};

function Spinner({
  className,
  size = "md",
  ...props
}: ComponentProps<"svg"> & { size?: keyof typeof spinnerSizes }) {
  const t = useExtracted();
  return (
    <Loader2Icon
      role="status"
      aria-label={t("Loading")}
      className={cn("animate-spin text-muted-foreground", spinnerSizes[size], className)}
      {...props}
    />
  );
}

export { Spinner };
