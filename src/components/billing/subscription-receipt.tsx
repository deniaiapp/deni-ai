import { useState } from "react";
import type { SubscriptionReceiptData } from "./subscription-receipt-data";
import { SubscriptionReceiptView } from "./subscription-receipt-view";

export type { SubscriptionReceiptData } from "./subscription-receipt-data";
export { ReceiptPaper } from "./receipt-paper";
export { ReceiptPrinterCard, receiptDeviceCardClassName } from "./receipt-printer-card";

export function SubscriptionReceipt({ data }: { data: SubscriptionReceiptData }) {
  const [playId, setPlayId] = useState(0);

  return (
    <SubscriptionReceiptView
      data={data}
      key={playId}
      onReplay={() => setPlayId((current) => current + 1)}
    />
  );
}
