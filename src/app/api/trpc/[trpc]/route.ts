import * as Sentry from "@sentry/nextjs";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { guardMutationRequest } from "@/lib/mutation-request";
import { limitRequestBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { TRPC_MAX_BATCH_SIZE, trpcBodyLimit } from "@/lib/trpc/limits";

const ENDPOINT = "/api/trpc";

const trimSlashes = (path: string) => path.replace(/^\/|\/$/g, "");

/** The procedures a request calls, read from its URL the way tRPC's fetch adapter does. */
function procedurePaths(req: Request) {
  const url = new URL(req.url);
  const path = trimSlashes(trimSlashes(url.pathname).slice(trimSlashes(ENDPOINT).length));
  return url.searchParams.get("batch") === "1" ? path.split(",") : [path];
}

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: ENDPOINT,
    req,
    router: appRouter,
    createContext,
    maxBatchSize: TRPC_MAX_BATCH_SIZE,
    // tRPC turns these into a response itself, so Next's onRequestError never sees them.
    onError({ error, path }) {
      if (error.code !== "INTERNAL_SERVER_ERROR") return;
      const cause = error.cause ?? error;
      console.error(`[trpc] ${path ?? "unknown"} failed:`, cause);
      Sentry.captureException(cause, { tags: { trpcPath: path ?? "unknown" } });
    },
  });

export { handler as GET };

export async function POST(req: Request) {
  const rejected = guardMutationRequest(req, "application/json");
  if (rejected) return rejected;
  try {
    // Per procedure: imports and comparison transcripts get more than the default.
    const limited = limitRequestBody(req, trpcBodyLimit(procedurePaths(req)));
    const response = await handler(limited.request);
    return limited.isTooLarge()
      ? Response.json({ error: "Request body is too large" }, { status: 413 })
      : response;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? "Request body is too large"
            : "Invalid request body",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
}
