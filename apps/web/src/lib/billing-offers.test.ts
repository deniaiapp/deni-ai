import { expect, test } from "vitest";
import { getFlashOfferLimit } from "@/lib/billing-offers";

const now = new Date("2026-10-12T00:00:00Z");
const later = new Date("2026-10-12T01:00:00Z");
const earlier = new Date("2026-10-11T23:00:00Z");
const neverPaid = { firstPaidAt: null, flashOfferEndsAt: null };

test("spots stay open for never-paid accounts until the coupon is redeemed that often", () => {
  expect(getFlashOfferLimit(neverPaid, 0, { spots: 2, now })).toEqual({
    kind: "spots",
    spots: 2,
    spotsLeft: 2,
  });
  expect(getFlashOfferLimit(undefined, 1, { spots: 2, now })).toMatchObject({ spotsLeft: 1 });
  expect(getFlashOfferLimit(neverPaid, 2, { spots: 2, now })).toBeNull();
  expect(getFlashOfferLimit(neverPaid, 3, { spots: 2, now })).toBeNull();
});

test("spots ignore account timers and skip accounts that paid before", () => {
  expect(
    getFlashOfferLimit({ firstPaidAt: null, flashOfferEndsAt: earlier }, 0, { spots: 2, now }),
  ).toMatchObject({ kind: "spots" });
  expect(
    getFlashOfferLimit({ firstPaidAt: earlier, flashOfferEndsAt: later }, 0, { spots: 2, now }),
  ).toBeNull();
});

test("without spots the offer follows the account timer", () => {
  expect(
    getFlashOfferLimit({ firstPaidAt: null, flashOfferEndsAt: later }, 5, { spots: null, now }),
  ).toEqual({ kind: "timer", endsAt: later.toISOString() });
  expect(
    getFlashOfferLimit({ firstPaidAt: null, flashOfferEndsAt: earlier }, 0, { spots: null, now }),
  ).toBeNull();
  expect(getFlashOfferLimit(neverPaid, 0, { spots: null, now })).toBeNull();
});
