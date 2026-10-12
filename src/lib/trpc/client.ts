"use client";

import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";

import type { AppRouter } from "@/server/api/root";
import { hasLargeBodyLimit, TRPC_MAX_BATCH_SIZE } from "@/lib/trpc/limits";

const url = "/api/trpc";

export function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        // A batch gets the smallest body cap among its calls, so a procedure
        // allowed a larger body (an import, a comparison transcript) goes alone.
        condition: (op) => hasLargeBodyLimit(op.path),
        true: httpLink({ url, transformer: superjson }),
        false: httpBatchLink({
          url,
          transformer: superjson,
          maxItems: TRPC_MAX_BATCH_SIZE,
        }),
      }),
    ],
  });
}
