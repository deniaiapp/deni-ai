import { initTRPC, TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";

import { db } from "@/db/drizzle";
import { auth } from "@/lib/auth";

export async function createContext(opts: FetchCreateContextFnOptions) {
  // Derive session from incoming request headers via better-auth
  const session = await auth.api.getSession({ headers: opts.req.headers });
  return { db, session };
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
