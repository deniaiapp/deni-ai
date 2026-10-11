import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";
import {
  AD_DELIVERY_TTL_MS,
  adCharge,
  adDeliveryStatus,
  eventKey,
  pickAd,
  signAdDelivery,
  verifyAdDelivery,
} from "./ads";

afterEach(() => {
  vi.useRealTimers();
});

describe("ad billing deduplication", () => {
  test("views are unique per account, campaign and ten-minute window", () => {
    assert.equal(eventKey("a", "user", "view", 0), eventKey("a", "user", "view", 599_999));
    assert.notEqual(eventKey("a", "user", "view", 0), eventKey("a", "user", "view", 600_000));
    assert.notEqual(eventKey("a", "user", "view", 0), eventKey("a", "other", "view", 0));
  });
  test("delivery tokens are bound to a campaign and account", () => {
    const token = signAdDelivery("ad", "viewer", "https://example.com/old");
    assert.equal(verifyAdDelivery(token, "ad", "viewer", "https://example.com/old"), true);
    assert.equal(verifyAdDelivery(token, "ad", "viewer", "https://example.com/new"), false);
    assert.equal(verifyAdDelivery(token, "other", "viewer"), false);
    assert.equal(verifyAdDelivery(token, "ad", "other"), false);
    assert.equal(verifyAdDelivery(token + "x", "ad", "viewer"), false);
  });
  test("delivery tokens bill for an hour and then only prove the ad was shown", () => {
    vi.useFakeTimers({ now: 0 });
    const token = signAdDelivery("ad", "viewer", "https://example.com");
    vi.setSystemTime(AD_DELIVERY_TTL_MS - 1);
    assert.equal(AD_DELIVERY_TTL_MS, 60 * 60_000);
    assert.equal(adDeliveryStatus(token, "ad", "viewer", "https://example.com"), "valid");
    vi.setSystemTime(AD_DELIVERY_TTL_MS);
    assert.equal(adDeliveryStatus(token, "ad", "viewer", "https://example.com"), "expired");
    assert.equal(verifyAdDelivery(token, "ad", "viewer", "https://example.com"), false);
    // Expiry never relaxes the signature, viewer or destination checks.
    assert.equal(adDeliveryStatus(token, "ad", "viewer", "https://example.com/new"), "invalid");
    assert.equal(adDeliveryStatus(token, "ad", "other", "https://example.com"), "invalid");
    assert.equal(adDeliveryStatus(`${token}x`, "ad", "viewer", "https://example.com"), "invalid");
  });
  test("normal views cost ¥200 per 1,000 and guest views cost half", () => {
    let normal = 0;
    let guest = 0;
    for (let n = 0; n < 1000; n++) {
      normal += adCharge("cpm", "view", n * 2, false);
      guest += adCharge("cpm", "view", n, true);
    }
    assert.equal(normal, 200);
    assert.equal(guest, 100);
    assert.equal(adCharge("cpm", "view", 9, true), 1);
    assert.equal(adCharge("cpm", "view", 8, false), 1);
    assert.equal(adCharge("cpm", "view", 7, false), 0);
  });
  test("guest clicks cost ¥15, signed-in clicks ¥30, and fixed ads no metered fee", () => {
    assert.equal(adCharge("cpc", "click", 0, false), 30);
    assert.equal(adCharge("cpc", "click", 0, true), 15);
    assert.equal(adCharge("cpc", "view", 0, true), 0);
    assert.equal(adCharge("fixed", "view", 8, true), 0);
  });
  test("rotates away from the last ad when another is available", () => {
    const ads = [
      { id: "first", plan: "cpm" },
      { id: "second", plan: "cpm" },
    ];
    assert.equal(pickAd(ads, "first", () => 0)?.id, "second");
    assert.equal(pickAd([ads[0]], "first", () => 0)?.id, "first");
    assert.equal(pickAd([], "first"), null);
  });
  test("keeps the reserved fixed slot ahead of rotating campaigns", () => {
    const ads = [
      { id: "fixed", plan: "fixed" },
      { id: "other", plan: "cpm" },
    ];
    assert.equal(pickAd(ads, "fixed")?.id, "fixed");
  });
  test("clicks are unique per account and day", () => {
    assert.equal(eventKey("a", "user", "click", 0), eventKey("a", "user", "click", 86_399_999));
    assert.notEqual(eventKey("a", "user", "click", 0), eventKey("a", "user", "click", 86_400_000));
  });
});
