import { beforeEach, expect, test, vi } from "vitest";
import { allowGuestAdBilling, anonymousAdViewerId } from "./ad-ip";
import { adCharge, eventKey, signAdDelivery, verifyAdDelivery } from "./ads";

const rateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rateLimit }));

const identity = (ip: string) => anonymousAdViewerId(new Headers({ "x-forwarded-for": ip }));

beforeEach(() => {
  rateLimit.mockReset().mockResolvedValue({ allowed: true });
});

test("hashes the first forwarded IP without exposing it", () => {
  const id = identity(" 192.0.2.1, 10.0.0.1 ");
  expect(id).toMatch(/^ip:[0-9a-f]{64}$/);
  expect(id).toBe(identity("192.0.2.1"));
  expect(id).not.toBe(identity("192.0.2.2"));
  expect(id).not.toContain("192.0.2.1");
});

test("canonicalizes IPv6 and IPv4-mapped IPv6", () => {
  expect(identity("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe(identity("2001:db8::1"));
  expect(identity("::ffff:192.0.2.1")).toBe(identity("192.0.2.1"));
  expect(identity("::ffff:c000:201")).toBe(identity("192.0.2.1"));
});

test("treats one IPv6 /64 as one viewer so rotating addresses cannot evade deduplication", () => {
  expect(identity("2001:db8:1:2::1")).toBe(identity("2001:db8:1:2:ffff:ffff:ffff:ffff"));
  expect(identity("2001:db8:1:2::1")).toBe(identity("2001:0db8:0001:0002:0:0:0:abcd"));
  expect(identity("2001:db8:1:2::1")).not.toBe(identity("2001:db8:1:3::1"));
  expect(identity("2001:db8:1:2::1")).not.toContain("2001");
});

test("caps billable guest events per network and kind across campaigns", async () => {
  const network = identity("2001:db8:1:2::1");
  expect(
    await allowGuestAdBilling(new Headers({ "x-forwarded-for": "2001:db8:1:2::9" }), "click"),
  ).toBe(true);
  expect(rateLimit).toHaveBeenLastCalledWith({
    key: `ad-guest-click:${network}`,
    windowMs: 86_400_000,
    maxRequests: 20,
  });
  await allowGuestAdBilling(new Headers({ "x-forwarded-for": "2001:db8:1:2::1" }), "view");
  expect(rateLimit).toHaveBeenLastCalledWith({
    key: `ad-guest-view:${network}`,
    windowMs: 3_600_000,
    maxRequests: 120,
  });
  rateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
  expect(await allowGuestAdBilling(new Headers({ "x-forwarded-for": "192.0.2.1" }), "view")).toBe(
    false,
  );
  rateLimit.mockClear();
  expect(await allowGuestAdBilling(new Headers(), "click")).toBe(true);
  expect(rateLimit).not.toHaveBeenCalled();
});

test("uses x-real-ip only when x-forwarded-for is absent and rejects invalid addresses", () => {
  expect(anonymousAdViewerId(new Headers({ "x-real-ip": "192.0.2.1" }))).toBe(
    identity("192.0.2.1"),
  );
  expect(anonymousAdViewerId(new Headers())).toBeUndefined();
  for (const ip of ["unknown", "", "not-an-ip", "192.0.2.1:1234", "[::1]", "fe80::1%eth0"]) {
    expect(identity(ip)).toBeUndefined();
  }
  expect(
    anonymousAdViewerId(new Headers({ "x-forwarded-for": "invalid", "x-real-ip": "192.0.2.1" })),
  ).toBeUndefined();
});

test("uses the configured client IP source and keeps canonicalization", () => {
  const edge = { header: "cf-connecting-ip" };
  expect(
    anonymousAdViewerId(
      new Headers({ "cf-connecting-ip": "::ffff:192.0.2.1", "x-forwarded-for": "192.0.2.9" }),
      edge,
    ),
  ).toBe(identity("192.0.2.1"));
  expect(
    anonymousAdViewerId(new Headers({ "x-forwarded-for": "192.0.2.1" }), edge),
  ).toBeUndefined();

  // Spoofed leftmost entries cannot change the identity behind an appending proxy.
  const appended = (chain: string) =>
    anonymousAdViewerId(new Headers({ "x-forwarded-for": chain }), { trustedProxyHops: 1 });
  expect(appended("198.51.100.1, 192.0.2.1")).toBe(identity("192.0.2.1"));
  expect(appended("198.51.100.2, 192.0.2.1")).toBe(identity("192.0.2.1"));
  expect(appended("192.0.2.1, invalid")).toBeUndefined();
});

test("deduplicates public views per IP/10 minutes and clicks per IP/day", () => {
  const viewer = identity("192.0.2.1")!;
  expect(eventKey("ad", viewer, "view", 0)).toBe(eventKey("ad", viewer, "view", 599_999));
  expect(eventKey("ad", viewer, "view", 0)).not.toBe(eventKey("ad", viewer, "view", 600_000));
  expect(eventKey("ad", viewer, "click", 0)).toBe(eventKey("ad", viewer, "click", 86_399_999));
  expect(eventKey("ad", viewer, "click", 0)).not.toBe(eventKey("ad", viewer, "click", 86_400_000));
  expect(eventKey("ad", viewer, "view", 0)).not.toBe(
    eventKey("ad", identity("192.0.2.2")!, "view", 0),
  );
  const token = signAdDelivery("ad", viewer, "https://example.com");
  expect(verifyAdDelivery(token, "ad", viewer)).toBe(true);
  expect(verifyAdDelivery(token, "ad", identity("192.0.2.2")!)).toBe(false);
});

test("bills IP viewers at the same half weight as anonymous guests", () => {
  let total = 0;
  for (let n = 0; n < 1000; n++) total += adCharge("cpm", "view", n, true);
  expect(total).toBe(100);
  expect(adCharge("cpc", "click", 0, true)).toBe(15);
});
