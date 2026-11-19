import { BlockList, isIP } from "node:net";
import type { Context } from "hono";

function normalizeIp(value: string): string {
  const ip = value.trim().toLowerCase();
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

function isTrustedProxy(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of (process.env.TRUSTED_PROXY_IPS ?? "").split(",")) {
    const [address, prefix] = entry.trim().split("/");
    const normalized = normalizeIp(address);
    const version = isIP(normalized);
    if (!version) continue;
    try {
      const type = version === 4 ? "ipv4" : "ipv6";
      if (prefix === undefined) list.addAddress(normalized, type);
      else if (/^\d+$/.test(prefix)) list.addSubnet(normalized, Number(prefix), type);
    } catch {
      // Invalid configuration never grants trust.
    }
  }
  return list.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Only a trusted transport peer may supply a forwarded client address. */
export function getClientIp(headers: Headers, peerAddress = "unknown"): string {
  const peer = normalizeIp(peerAddress);
  if (!isIP(peer)) return "unknown";
  if (!isTrustedProxy(peer)) return peer;

  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for";
  if (!["x-forwarded-for", "x-real-ip", "cf-connecting-ip"].includes(header)) return peer;
  const raw = headers.get(header);
  if (!raw) return peer;
  const hops = raw.split(",").map(normalizeIp);
  if (header !== "x-forwarded-for") {
    if (hops.some((hop) => !isIP(hop))) return peer;
    return hops.length === 1 ? hops[0] : peer;
  }

  // Walk from the transport peer towards the client. Ignore attacker-supplied
  // entries (valid or not) to the left of the first untrusted hop. A malformed
  // hop where the client address belongs yields no identity, never the
  // trusted peer's own address.
  let address = peer;
  for (let i = hops.length - 1; i >= 0 && isTrustedProxy(address); i--) {
    address = hops[i];
    if (!isIP(address)) return "unknown";
  }
  return address;
}

export function getRequestClientIp(c: Context): string {
  const server = c.env?.server as { requestIP(req: Request): { address: string } | null } | undefined;
  const peer = server?.requestIP(c.req.raw)?.address;
  return getClientIp(c.req.raw.headers, peer);
}
