import { RotateCcw } from "lucide-react";
import { useExtracted, useLocale } from "use-intl";
import { useId } from "react";
import { formatMinorCurrency } from "@/lib/currency";
import { formatReceiptOrderId } from "@/lib/stripe-checkout-receipt";
import { formatReceiptDate } from "./format-receipt-date";
import { ReceiptPaper } from "./receipt-paper";
import { ReceiptPrinterCard } from "./receipt-printer-card";
import { ReceiptStatus } from "./receipt-status";
import type { SubscriptionReceiptData } from "./subscription-receipt-data";
import { PRINT_MS, useReceiptPlayback } from "./use-receipt-playback";

export function SubscriptionReceiptView({
  data,
  onReplay,
}: {
  data: SubscriptionReceiptData;
  onReplay: () => void;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const replayLabelId = useId();
  const {
    handlePrintTransitionEnd,
    isAnimating,
    isPrinting,
    paperHeight,
    paperRef,
    phase,
    shouldReduceMotion,
  } = useReceiptPlayback();
  const orderId = formatReceiptOrderId(data.sessionId);
  const paidAtLabel = formatReceiptDate(data.paidAt, locale);
  const money = (amount: number) => formatMinorCurrency(amount, data.currency, undefined, locale);

  return (
    <div className="relative mx-auto w-full max-w-xl overflow-x-clip px-3 py-6 sm:py-10">
      <div className="mb-4 flex justify-end">
        <button
          aria-labelledby={replayLabelId}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground shadow-xs backdrop-blur-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
          disabled={isAnimating}
          onClick={onReplay}
          type="button"
        >
          <RotateCcw className="size-3.5" />
          <span id={replayLabelId}>{t("Replay")}</span>
        </button>
      </div>

      <div className="relative mx-auto w-full max-w-[min(24rem,100%)]">
        <ReceiptPrinterCard
          homeHref={data.homeHref}
          homeLabel={data.homeLabel}
          outlet={
            <div
              className="relative z-50 mx-5 -mt-2 overflow-hidden"
              onTransitionEnd={handlePrintTransitionEnd}
              style={{
                maxHeight: isPrinting || shouldReduceMotion ? paperHeight : 0,
                transition: shouldReduceMotion
                  ? "max-height 0ms linear"
                  : `max-height ${PRINT_MS}ms cubic-bezier(0.22, 0.12, 0.18, 1)`,
              }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-7 bg-gradient-to-b from-[#171717] to-transparent"
              />
              <div ref={paperRef}>
                <ReceiptPaper
                  data={data}
                  money={money}
                  orderId={orderId}
                  paidAtLabel={paidAtLabel}
                />
              </div>
            </div>
          }
          planDescription={data.planDescription}
          planTitle={data.planTitle}
          totalAmount={money(data.amountTotal)}
        >
          <ReceiptStatus phase={phase} />
        </ReceiptPrinterCard>
      </div>
    </div>
  );
}
