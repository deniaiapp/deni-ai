import { z } from "zod";

/** Major version of the native client API, the `v1` in `/api/client/v1`. */
export const CLIENT_API_VERSION = 1;

/** Base path of the native client API on the web app's origin. */
export const CLIENT_API_BASE_PATH = `/api/client/v${CLIENT_API_VERSION}`;

/**
 * Every request of a native client names itself in this header:
 * `desktop/<semver> (<os>; <arch>)`, for example
 * `desktop/1.0.0 (windows; x86_64)`. The server compares the version with
 * `bootstrap.client.minVersion` and answers 426 `client_update_required` when
 * the client is too old.
 */
export const CLIENT_HEADER = "x-deni-client";

export const CLIENT_PRODUCTS = ["desktop"] as const;
export type ClientProduct = (typeof CLIENT_PRODUCTS)[number];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export const clientIdentitySchema = z.object({
  product: z.enum(CLIENT_PRODUCTS),
  version: z.string().regex(SEMVER),
  os: z.string().min(1).max(32).nullable(),
  arch: z.string().min(1).max(32).nullable(),
});
export type ClientIdentity = z.infer<typeof clientIdentitySchema>;

/** Parses an `x-deni-client` value; null when it is missing or malformed. */
export function parseClientHeader(value: string | null | undefined): ClientIdentity | null {
  if (!value) return null;
  const match = /^([a-z]+)\/(\S+)(?:\s+\(([^;()]+);\s*([^;()]+)\))?$/.exec(value.trim());
  if (!match) return null;
  const parsed = clientIdentitySchema.safeParse({
    product: match[1],
    version: match[2],
    os: match[3]?.trim() ?? null,
    arch: match[4]?.trim() ?? null,
  });
  return parsed.success ? parsed.data : null;
}

/** Formats the header a client sends. */
export function formatClientHeader(identity: ClientIdentity): string {
  const platform = identity.os && identity.arch ? ` (${identity.os}; ${identity.arch})` : "";
  return `${identity.product}/${identity.version}${platform}`;
}

/**
 * Compares two semantic versions: negative when `a` is older than `b`, zero
 * when equal, positive when newer. A pre-release sorts before its release
 * (`1.0.0-beta.1` < `1.0.0`); pre-release identifiers compare as strings,
 * numerically when both are numbers.
 */
export function compareVersions(a: string, b: string): number {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) throw new Error(`Not a semantic version: ${left ? b : a}`);
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff !== 0) return diff;
  }
  const leftPre = left[4];
  const rightPre = right[4];
  if (leftPre === rightPre) return 0;
  if (leftPre === undefined) return 1;
  if (rightPre === undefined) return -1;
  const leftParts = leftPre.split(".");
  const rightParts = rightPre.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const l = leftParts[index];
    const r = rightParts[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l) ? Number(l) : Number.NaN;
    const rn = /^\d+$/.test(r) ? Number(r) : Number.NaN;
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
    return l < r ? -1 : 1;
  }
  return 0;
}
