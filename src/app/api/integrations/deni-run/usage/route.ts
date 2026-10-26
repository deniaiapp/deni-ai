import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/drizzle";
import { user } from "@/db/schema";
import { env } from "@/env";
import { DENI_RUN_METRICS, getDeniRunUsage, recordDeniRunUsage } from "@/lib/product-usage";

/**
 * Server-to-server API for Deni Run. Deni Run signs users in with Deni AI
 * (OAuth), so `userId` is the Deni AI user id (the OIDC `sub`). It reads the
 * user's plan budget before work and reports incurred cost afterwards.
 */

const recordSchema = z.object({
  userId: z.string().min(1),
  metric: z.enum(DENI_RUN_METRICS as [string, ...string[]]),
  costUsd: z.number().finite().nonnegative().max(1_000),
});

function authorized(request: Request) {
  if (!env.DENI_RUN_SERVICE_SECRET) return false;
  const expected = Buffer.from(`Bearer ${env.DENI_RUN_SERVICE_SECRET}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/** An error response when the user cannot use Deni Run, else null. */
async function accountError(userId: string) {
  const [account] = await db
    .select({ isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!account) return Response.json({ error: "user_not_found" }, { status: 404 });
  if (account.isAnonymous) return Response.json({ error: "guest_account" }, { status: 403 });
  return null;
}

async function usageResponse(userId: string) {
  const usage = await getDeniRunUsage(userId);
  return Response.json(
    { userId, ...usage, manageUrl: `${env.NEXT_PUBLIC_BETTER_AUTH_URL}/settings/billing` },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!env.DENI_RUN_SERVICE_SECRET)
    return Response.json({ error: "Deni Run integration is disabled" }, { status: 503 });
  if (!authorized(request)) return new Response(null, { status: 401 });
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });
  return (await accountError(userId)) ?? usageResponse(userId);
}

export async function POST(request: Request) {
  if (!env.DENI_RUN_SERVICE_SECRET)
    return Response.json({ error: "Deni Run integration is disabled" }, { status: 503 });
  if (!authorized(request)) return new Response(null, { status: 401 });
  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const { userId, metric, costUsd } = parsed.data;
  const error = await accountError(userId);
  if (error) return error;
  await recordDeniRunUsage({
    userId,
    metric: metric as (typeof DENI_RUN_METRICS)[number],
    costUsd,
  });
  return usageResponse(userId);
}
