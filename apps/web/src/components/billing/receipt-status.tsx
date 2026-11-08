import { Check, LoaderCircle } from "lucide-react";
import { useExtracted } from "use-intl";
import type { ReceiptPhase } from "./use-receipt-playback";

export function ReceiptStatus({ phase }: { phase: ReceiptPhase }) {
  const t = useExtracted();

  if (phase === "complete") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-emerald-400">
        <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
        {t("Order complete")}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[13px] text-white/55">
      <LoaderCircle className="size-3.5 animate-spin" />
      {phase === "printing" ? t("Printing your receipt") : t("Processing your order")}
    </div>
  );
}
