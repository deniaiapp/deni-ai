import type Stripe from "stripe";

/** Plan prices are shown in yen to visitors from Japan and in US dollars everywhere else. */
export type PlanDisplayCurrency = "jpy" | "usd";

/**
 * The visitor's country from Cloudflare's `CF-IPCountry` header (ISO 3166-1 alpha-2),
 * or undefined off Cloudflare. It only picks a display currency, so a spoofed header
 * changes nothing that is charged.
 */
export function requestCountry(headers: Pick<Headers, "get">) {
  return headers.get("cf-ipcountry")?.trim().toUpperCase() || undefined;
}

export function planDisplayCurrency(country: string | undefined): PlanDisplayCurrency {
  return country === "JP" ? "jpy" : "usd";
}

/**
 * The price's amount in `currency` from its `currency_options` (list prices with
 * `expand: ["data.currency_options"]`), else its default currency and amount.
 * Checkout charges the same currency option for a customer in that country.
 */
export function priceInCurrency(price: Stripe.Price, currency: PlanDisplayCurrency) {
  const option = price.currency === currency ? null : price.currency_options?.[currency];
  return option?.unit_amount != null
    ? { amount: option.unit_amount, currency }
    : { amount: price.unit_amount, currency: price.currency };
}
