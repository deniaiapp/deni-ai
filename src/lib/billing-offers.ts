import { env } from "@/env";

export const FLASH_OFFER_DURATION_HOURS = 24;
/** Flash offer length granted once for verifying a card. */
export const CARD_FLASH_OFFER_DURATION_HOURS = 48;
/**
 * When set, the flash offer is open to every never-paid account until the
 * coupon has been redeemed this many times, instead of following per-account
 * timers. Set to null to return to the timers.
 */
export const FLASH_OFFER_SPOTS: number | null = 2;

/** How a flash offer ends: an account's countdown, or the shared purchase spots. */
export type FlashOfferLimit =
  | { kind: "timer"; endsAt: string }
  | { kind: "spots"; spots: number; spotsLeft: number };

export function createFlashOfferEndAt(now = new Date()) {
  return new Date(now.getTime() + FLASH_OFFER_DURATION_HOURS * 60 * 60 * 1000);
}

export function isFlashOfferPlan(planId: string | null | undefined) {
  if (!planId) {
    return false;
  }

  return planId.endsWith("_yearly") || planId.endsWith("_lifetime");
}

export function isFlashOfferActive(flashOfferEndsAt: Date | null | undefined, now = new Date()) {
  if (!flashOfferEndsAt) {
    return false;
  }

  return flashOfferEndsAt.getTime() > now.getTime();
}

/**
 * The limit of the flash offer an account can use now, or null when it has none.
 * `timesRedeemed` is the coupon's redemption count across all customers.
 */
export function getFlashOfferLimit(
  record: { firstPaidAt: Date | null; flashOfferEndsAt: Date | null } | null | undefined,
  timesRedeemed: number,
  { spots = FLASH_OFFER_SPOTS, now = new Date() }: { spots?: number | null; now?: Date } = {},
): FlashOfferLimit | null {
  if (spots === null) {
    return record?.flashOfferEndsAt && isFlashOfferActive(record.flashOfferEndsAt, now)
      ? { kind: "timer", endsAt: record.flashOfferEndsAt.toISOString() }
      : null;
  }

  const spotsLeft = Math.max(0, spots - timesRedeemed);
  if (spotsLeft === 0 || record?.firstPaidAt) {
    return null;
  }

  return { kind: "spots", spots, spotsLeft };
}

export function getFlashOfferCouponId() {
  return env.STRIPE_FLASH_OFFER_COUPON_ID ?? null;
}
