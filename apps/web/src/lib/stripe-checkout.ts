import type Stripe from "stripe";

export const customCheckoutRequestOptions: Stripe.RequestOptions = {
  apiVersion: "2026-03-25.dahlia",
};

/**
 * Always request 3D Secure, matching the Radar rule that also blocks
 * `:card_3d_secure_support: = 'not_supported'`. `automatic` would let
 * Stripe skip 3DS on low-risk cards; Radar already rejects cards that
 * cannot authenticate.
 */
export const requestThreeDSecure = "any" as const;

export const checkoutCardPaymentMethodOptions = {
  card: {
    request_three_d_secure: requestThreeDSecure,
  },
} as const satisfies Stripe.Checkout.SessionCreateParams.PaymentMethodOptions;
