import type Stripe from "stripe";

export const checkoutSessionExpand = [
  "payment_intent.payment_method",
  "subscription.default_payment_method",
] as const;

export type CheckoutSessionSummary = {
  sessionId: string;
  clientSecret: string | null;
  status: "open" | "complete" | "expired";
  paymentStatus: string | null;
  amountTotal: number | null;
  amountSubtotal: number | null;
  amountTax: number | null;
  amountDiscount: number | null;
  currency: string | null;
  mode: string;
  planId: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paidAt: string | null;
};

function asCardPaymentMethod(
  value: string | Stripe.PaymentMethod | null | undefined,
): { brand: string; last4: string } | null {
  if (!value || typeof value === "string" || value.type !== "card" || !value.card) {
    return null;
  }

  const brand = value.card.brand?.trim();
  const last4 = value.card.last4?.trim();
  if (!brand || !last4) {
    return null;
  }

  return { brand, last4 };
}

function getSessionCard(session: Stripe.Checkout.Session) {
  const paymentIntent = session.payment_intent;
  if (paymentIntent && typeof paymentIntent !== "string") {
    const fromIntent = asCardPaymentMethod(paymentIntent.payment_method);
    if (fromIntent) {
      return fromIntent;
    }
  }

  const subscription = session.subscription;
  if (subscription && typeof subscription !== "string") {
    return asCardPaymentMethod(subscription.default_payment_method);
  }

  return null;
}

export function summarizeCheckoutSession(session: Stripe.Checkout.Session): CheckoutSessionSummary {
  const card = getSessionCard(session);
  const status: CheckoutSessionSummary["status"] =
    session.status === "complete" ? "complete" : session.status === "expired" ? "expired" : "open";

  return {
    sessionId: session.id,
    clientSecret: session.client_secret,
    status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    amountSubtotal: session.amount_subtotal,
    amountTax: session.total_details?.amount_tax ?? null,
    amountDiscount: session.total_details?.amount_discount ?? null,
    currency: session.currency,
    mode: session.mode ?? "subscription",
    planId: session.metadata?.planId ?? null,
    paymentMethodBrand: card?.brand ?? null,
    paymentMethodLast4: card?.last4 ?? null,
    paidAt: session.created ? new Date(session.created * 1000).toISOString() : null,
  };
}

export function formatReceiptOrderId(sessionId: string) {
  const compact = sessionId
    .replaceAll(/[^a-zA-Z0-9]/g, "")
    .slice(-4)
    .toUpperCase();
  return `ORD-${compact.padStart(4, "0")}`;
}

export function formatCardBrand(brand: string) {
  const normalized = brand.trim().toLowerCase();
  const brands: Record<string, string> = {
    amex: "Amex",
    american_express: "Amex",
    diners: "Diners",
    discover: "Discover",
    jcb: "JCB",
    mastercard: "Mastercard",
    unionpay: "UnionPay",
    visa: "Visa",
  };

  if (brands[normalized]) {
    return brands[normalized];
  }

  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function formatPaymentMethodLabel(brand: string | null, last4: string | null) {
  if (!last4) {
    return null;
  }

  const brandLabel = brand ? formatCardBrand(brand) : null;
  return brandLabel ? `${brandLabel} •••• ${last4}` : `•••• ${last4}`;
}
