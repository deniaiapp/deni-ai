import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";

import { db } from "@/db/drizzle";
import { auth } from "@/lib/auth";
import { requestCountry } from "@/lib/plan-currency";
import { checkRateLimit } from "@/lib/rate-limit";

export async function createContext(opts: FetchCreateContextFnOptions) {
  // Derive session from incoming request headers via better-auth
  const session = await auth.api.getSession({ headers: opts.req.headers });
  // Optional so callers built without a request (tests) need not supply it.
  const country: string | undefined = requestCountry(opts.req.headers);
  return { db, session, country } as { db: typeof db; session: typeof session; country?: string };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/**
 * True for an error tRPC wrapped from an unexpected throw (database, Stripe, ...):
 * its message is the original one, e.g. drizzle's "Failed query: <SQL> params: <values>".
 * TRPCErrors thrown on purpose set their own message, and Stripe card errors
 * ("Your card was declined.") are written for the customer, so both pass through.
 */
function isUnexpectedTRPCError(error: TRPCError) {
  return (
    error.code === "INTERNAL_SERVER_ERROR" &&
    error.cause !== undefined &&
    error.message === error.cause.message &&
    (error.cause as { type?: unknown }).type !== "StripeCardError"
  );
}

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Send only the code, which clients localize; the route's onError logs the cause.
    if (process.env.NODE_ENV === "production" && isUnexpectedTRPCError(error)) {
      return { ...shape, message: error.code };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
const enforceUser = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.session.session.userId,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceUser);

export type ProtectedContext = Context & { userId: string };

export type TRPCRateLimit = { windowMs: number; maxRequests: number };

/**
 * Per-user budgets for procedures that call Stripe or read many rows on every
 * call. The client caches queries for 60 s without refetching on focus
 * (src/lib/query-client.ts) and refetches them after related mutations, so
 * normal use stays several times below these.
 */
export const TRPC_RATE_LIMITS = {
  /** Stripe-backed reads: one fetch per page or dialog open, plus refetches after billing changes. */
  stripeRead: { windowMs: 60_000, maxRequests: 30 },
  /** Stripe-backed reads that the team Max Mode editor refetches after every saved field. */
  stripeReadPerEdit: { windowMs: 60_000, maxRequests: 60 },
  /** Stripe-backed mutations, each one click (checkout, portal, plan change, cancel, ...). */
  stripeWrite: { windowMs: 60_000, maxRequests: 10 },
  /**
   * Card verification: each intent is a $1 authorization its client secret can
   * attempt with any card, so the budget is per hour. Reopening the dialog
   * reuses an intent still waiting for a card; each authorized card uses one up.
   */
  cardVerification: { windowMs: 60 * 60_000, maxRequests: 10 },
  /**
   * chat.getChats returns every chat. It is refetched after each sent message
   * (30 a minute) and after each sidebar delete, pin, edit or move, which
   * have no confirmation step.
   */
  chatList: { windowMs: 60_000, maxRequests: 120 },
} as const satisfies Record<string, TRPCRateLimit>;

/**
 * Limits each user's calls of one procedure with the shared limiter (Upstash
 * when configured, otherwise per instance). Add it before `.input()`, so a
 * refused call never parses its input. Keyed by user id: no public procedure
 * uses it, and one would need an IP key instead.
 */
export function rateLimited(name: string, limit: TRPCRateLimit) {
  return t.middleware(async ({ ctx, next }) => {
    const userId = ctx.session?.session?.userId;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const result = await checkRateLimit({ key: `trpc:${name}:${userId}`, ...limit });
    if (!result.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please try again later.",
      });
    }
    return next();
  });
}
