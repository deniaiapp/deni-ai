export type SubscriptionReceiptData = {
  sessionId: string;
  planTitle: string;
  planDescription: string;
  planLineLabel: string;
  amountTotal: number;
  amountSubtotal: number | null;
  amountTax: number | null;
  amountDiscount: number | null;
  currency: string;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paidAt: string | Date | null;
  homeHref: string;
  homeLabel: string;
};
