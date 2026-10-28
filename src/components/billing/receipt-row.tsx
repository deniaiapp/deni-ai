import { cn } from "@/lib/utils";

export function ReceiptRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-6 text-[11px] leading-5",
        muted ? "text-[#8a857c]" : "text-[#1a1a1a]",
      )}
    >
      <span>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}
