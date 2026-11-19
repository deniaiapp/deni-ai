import { useExtracted } from "use-intl";
import DeniAIIcon from "@/components/deni-ai-icon";
import { formatPaymentMethodLabel } from "@/lib/stripe-checkout-receipt";
import { ReceiptBarcode } from "./receipt-barcode";
import { ReceiptRow } from "./receipt-row";
import type { SubscriptionReceiptData } from "./subscription-receipt-data";

const PAPER = "#f4f1ea";
const PAPER_INK = "#1a1a1a";

export function ReceiptPaper({
  data,
  orderId,
  paidAtLabel,
  money,
}: {
  data: SubscriptionReceiptData;
  orderId: string;
  paidAtLabel: string;
  money: (amount: number) => string;
}) {
  const t = useExtracted();
  const paymentMethod = formatPaymentMethodLabel(data.paymentMethodBrand, data.paymentMethodLast4);
  const lineAmount = data.amountSubtotal ?? data.amountTotal;
  const showSubtotal = data.amountSubtotal !== null;
  const showTax = (data.amountTax ?? 0) > 0;
  const showDiscount = (data.amountDiscount ?? 0) > 0;

  return (
    <div
      className="relative z-1000 origin-top pt-8 shadow-[0_16px_28px_-10px_rgba(0,0,0,0.38)]"
      style={{
        backgroundColor: PAPER,
        color: PAPER_INK,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14 bg-gradient-to-b from-black/40 via-black/14 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 mix-blend-multiply"
        style={{
          backgroundImage: "radial-gradient(rgba(40,32,20,0.045) 0.6px, transparent 0.6px)",
          backgroundSize: "3px 3px",
        }}
      />

      <div className="relative px-5 pb-4 sm:px-7">
        <div className="flex justify-center">
          <div className="flex size-12 items-center justify-center rounded-md bg-[#161616] text-white">
            <DeniAIIcon className="size-7" />
          </div>
        </div>

        <div className="mt-10 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase">
              {data.planLineLabel}
            </div>
            <div className="mt-0.5 text-[11px] text-[#8a857c]">{data.planDescription}</div>
          </div>
          <div className="shrink-0 text-[11px] tabular-nums">{money(lineAmount)}</div>
        </div>

        <div className="mt-6 border-t border-[#1a1a1a]/15 pt-4">
          {showSubtotal ? (
            <ReceiptRow
              label={t("Subtotal")}
              muted
              value={money(data.amountSubtotal ?? lineAmount)}
            />
          ) : null}
          {showDiscount ? (
            <ReceiptRow label={t("Discount")} muted value={`−${money(data.amountDiscount ?? 0)}`} />
          ) : null}
          {showTax ? (
            <ReceiptRow label={t("Tax")} muted value={money(data.amountTax ?? 0)} />
          ) : null}
          <div className="mt-3 flex items-start justify-between gap-4 text-[13px] font-semibold tracking-[0.06em] uppercase">
            <span>{t("Total paid")}</span>
            <span className="tabular-nums">{money(data.amountTotal)}</span>
          </div>
        </div>

        <div className="mt-8 space-y-1">
          <ReceiptRow label={t("Order")} muted value={orderId} />
          {paymentMethod ? <ReceiptRow label={t("Paid with")} muted value={paymentMethod} /> : null}
          <ReceiptRow label={t("Date")} muted value={paidAtLabel} />
        </div>

        <div className="mt-8">
          <ReceiptBarcode value={orderId} />
        </div>
      </div>
      <div
        aria-hidden="true"
        className="h-3 w-full"
        style={{
          backgroundImage: `linear-gradient(135deg, ${PAPER} 50%, transparent 50%), linear-gradient(-135deg, ${PAPER} 50%, transparent 50%)`,
          backgroundPosition: "0 0, 8px 0",
          backgroundRepeat: "repeat-x",
          backgroundSize: "16px 12px",
        }}
      />
    </div>
  );
}
