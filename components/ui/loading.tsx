import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function LoadingFallback({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 py-12", className)}
      role="status"
    >
      <Spinner size="md" />
      {label ? <span className="text-xs text-[#8f8f8f]">{label}</span> : null}
    </div>
  );
}
