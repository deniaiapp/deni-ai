import { createHmac } from "node:crypto";
import { resolveClientIp, type ClientIpOptions } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { networkKey } from "@/lib/signup-risk";
import { env } from "@/env";

/** Billable guest events one network may record across all campaigns. */
const GUEST_EVENT_LIMITS = {
  view: { windowMs: 60 * 60_000, maxRequests: 120 },
  click: { windowMs: 86_400_000, maxRequests: 20 },
} as const;

/**
 * Client IP resolution follows `CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS` (see SETUP.md).
 * One identity per network: an IPv4 address, or an IPv6 /64, because one subscriber
 * controls a whole /64 and could otherwise rotate addresses to evade deduplication.
 */
export function anonymousAdViewerId(
  headers: Pick<Headers, "get">,
  options?: ClientIpOptions,
): string | undefined {
  const ip = resolveClientIp(headers, options);
  if (!ip) return undefined;

  // networkKey also canonicalizes IPv6 spellings and folds IPv4-mapped IPv6 into IPv4.
  // Never store or expose the raw IP; namespace separately from account IDs.
  return `ip:${createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`deni-ads-ip:${networkKey(ip)}`)
    .digest("hex")}`;
}

/**
 * Whether a guest event from this network may still be billed. Deduplication is per
 * viewer and campaign, so this also caps the network across campaigns and guest
 * sessions. Without a usable IP nothing is limited.
 */
export async function allowGuestAdBilling(
  headers: Pick<Headers, "get">,
  kind: "view" | "click",
  options?: ClientIpOptions,
): Promise<boolean> {
  const network = anonymousAdViewerId(headers, options);
  if (!network) return true;
  const result = await checkRateLimit({
    key: `ad-guest-${kind}:${network}`,
    ...GUEST_EVENT_LIMITS[kind],
  });
  return result.allowed;
}
