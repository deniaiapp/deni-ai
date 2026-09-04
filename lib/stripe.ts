import "server-only";

import Stripe from "stripe";

let client: Stripe | null | undefined;

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_PRICE_PRO?.trim());
}

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

export function proPriceId() {
  const price = process.env.STRIPE_PRICE_PRO?.trim();
  if (!price) throw new Error("STRIPE_PRICE_PRO is not configured");
  return price;
}

export function appUrl(req: Request) {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}
