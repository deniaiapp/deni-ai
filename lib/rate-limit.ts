import "server-only";

import { getExtracted } from "next-intl/server";
import { sqlClient } from "@/db";

export class RateLimitError extends Error {
  code = "rate_limit" as const;
  constructor() {
    super("Too many requests. Wait a moment and try again.");
    this.name = "RateLimitError";
  }
}

const memory = new Map<string, { start: number; count: number }>();

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = memory.get(key);
  if (!current || now - current.start >= windowMs) {
    memory.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

async function databaseLimit(key: string, limit: number, windowMs: number) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const rows = await sqlClient<{ count: number }[]>`
    INSERT INTO rate_limits AS r (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN r.window_start <= now() - (${windowSeconds}::text || ' seconds')::interval THEN 1
        ELSE r.count + 1
      END,
      window_start = CASE
        WHEN r.window_start <= now() - (${windowSeconds}::text || ' seconds')::interval THEN now()
        ELSE r.window_start
      END
    RETURNING count
  `;
  const count = rows[0]?.count ?? 1;
  return count <= limit;
}

export async function assertRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowMs = 60_000,
) {
  const key = `${userId}:${bucket}`;
  try {
    const allowed = await databaseLimit(key, limit, windowMs);
    if (!allowed) throw new RateLimitError();
    return;
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
  }
  if (!memoryLimit(key, limit, windowMs)) throw new RateLimitError();
}

export async function rateLimitResponse() {
  const t = await getExtracted();
  return new Response(t("Too many requests. Wait a moment and try again."), {
    status: 429,
    headers: { "Retry-After": "30" },
  });
}

export async function limitOrResponse(
  userId: string,
  bucket: string,
  limit: number,
  windowMs = 60_000,
) {
  try {
    await assertRateLimit(userId, bucket, limit, windowMs);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse();
    throw error;
  }
}
