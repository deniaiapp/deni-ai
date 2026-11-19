import { beforeEach, expect, test, vi } from "vitest";
import { env } from "@/env";
import { GET } from "./route";
import { anonymousAdViewerId } from "@/lib/ad-ip";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  campaign: vi.fn(),
  eligible: vi.fn(),
  freeViewer: vi.fn(),
  verify: vi.fn(),
  record: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/db/drizzle", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.campaign }) }) }) },
}));
vi.mock("@/lib/ads", () => ({
  adEligible: mocks.eligible,
  adDeliveryStatus: mocks.verify,
  recordAdEvent: mocks.record,
}));
vi.mock("@/lib/usage", () => ({ isFreeAdViewer: mocks.freeViewer }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));

const id = "12345678-1234-1234-1234-123456789abc";
const destination = "https://advertiser.example/landing";
function clickRequest(
  referer = `${new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin}/chat`,
  ip?: string,
  token = "signed-token",
) {
  return new Request(`http://internal-proxy:3000/api/ads/click?id=${id}&token=${token}`, {
    headers: { referer, "sec-fetch-site": "same-origin", ...(ip ? { "x-forwarded-for": ip } : {}) },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ session: { userId: "viewer" }, user: { isAnonymous: false } });
  mocks.freeViewer.mockResolvedValue(true);
  mocks.campaign.mockResolvedValue([{ id, userId: "advertiser", url: destination }]);
  mocks.verify.mockReturnValue("valid");
  mocks.rateLimit.mockResolvedValue({ allowed: true });
});

test("redirects a valid public-origin click through an internal proxy and records it", async () => {
  const response = await GET(clickRequest());
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(destination);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(mocks.verify).toHaveBeenCalledWith("signed-token", id, "viewer", destination);
  expect(mocks.record).toHaveBeenCalledWith(id, "viewer", "click", false);
});

test("rejects foreign referrers before accessing the session or billing", async () => {
  expect((await GET(clickRequest("https://other.example/chat"))).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

test("still rejects invalid delivery tokens without recording a click", async () => {
  mocks.verify.mockReturnValue("invalid");
  expect((await GET(clickRequest())).status).toBe(403);
  expect(mocks.record).not.toHaveBeenCalled();
});

test("opens the advertiser's site for an expired card without billing the click", async () => {
  mocks.session.mockResolvedValue(null);
  const req = clickRequest(undefined, "192.0.2.1");
  const viewer = anonymousAdViewerId(req.headers)!;
  const { signAdDelivery, adDeliveryStatus, AD_DELIVERY_TTL_MS } =
    await vi.importActual<typeof import("@/lib/ads")>("@/lib/ads");
  mocks.verify.mockImplementation(adDeliveryStatus);
  vi.useFakeTimers({ now: 0 });
  try {
    const token = signAdDelivery(id, viewer, destination);
    vi.setSystemTime(AD_DELIVERY_TTL_MS + 1);
    const response = await GET(clickRequest(undefined, "192.0.2.1", token));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(destination);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("still opens but does not bill guest clicks over the network cap", async () => {
  mocks.session.mockResolvedValue(null);
  mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
  const response = await GET(clickRequest(undefined, "2001:db8:1:2::1"));
  expect(response.status).toBe(303);
  expect(mocks.rateLimit).toHaveBeenCalledWith(
    expect.objectContaining({
      key: `ad-guest-click:${anonymousAdViewerId(new Headers({ "x-forwarded-for": "2001:db8:1:2::2" }))}`,
    }),
  );
  expect(mocks.record).not.toHaveBeenCalled();
});

test("does not cap signed-in free users by network", async () => {
  mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
  expect((await GET(clickRequest(undefined, "192.0.2.1"))).status).toBe(303);
  expect(mocks.rateLimit).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledWith(id, "viewer", "click", false);
});

test("records a public homepage click at guest weight with an IP-bound token", async () => {
  mocks.session.mockResolvedValue(null);
  const req = clickRequest(`${new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin}/home`, "192.0.2.1");
  const viewer = anonymousAdViewerId(req.headers)!;
  const { signAdDelivery, adDeliveryStatus } =
    await vi.importActual<typeof import("@/lib/ads")>("@/lib/ads");
  mocks.verify.mockImplementation(adDeliveryStatus);
  const token = signAdDelivery(id, viewer, destination);
  const response = await GET(
    clickRequest(`${new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin}/home`, "192.0.2.1", token),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(destination);
  expect(mocks.record).toHaveBeenCalledWith(id, viewer, "click", true);
  expect(mocks.eligible).toHaveBeenCalledWith(true);
  expect(mocks.freeViewer).not.toHaveBeenCalled();
});

test("rejects a public click token issued for another IP", async () => {
  mocks.session.mockResolvedValue(null);
  const { signAdDelivery, adDeliveryStatus } =
    await vi.importActual<typeof import("@/lib/ads")>("@/lib/ads");
  mocks.verify.mockImplementation(adDeliveryStatus);
  const viewer = anonymousAdViewerId(new Headers({ "x-forwarded-for": "192.0.2.1" }))!;
  const token = signAdDelivery(id, viewer, destination);
  expect((await GET(clickRequest(undefined, "192.0.2.2", token))).status).toBe(403);
  expect(mocks.record).not.toHaveBeenCalled();
});

test("does not bill public clicks without an IP", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(clickRequest())).status).toBe(401);
  expect(mocks.record).not.toHaveBeenCalled();
});

test("does not let paid accounts fall back to IP billing", async () => {
  mocks.freeViewer.mockResolvedValue(false);
  expect((await GET(clickRequest(undefined, "192.0.2.1"))).status).toBe(403);
  expect(mocks.record).not.toHaveBeenCalled();
});
