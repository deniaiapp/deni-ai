import Stripe from "stripe";
import { env } from "@/env";

// Keep imports safe when Stripe is intentionally disabled. All call sites that
// can reach the Stripe API are protected by the billing capability guard.
const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim() || "billing-disabled";
export const stripe = new Stripe(stripeSecretKey);
