"use client";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import type { AppRouter } from "@/server/api/root";
import { TRPC_MAX_BATCH_SIZE } from "@/lib/trpc/limits";

export function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        maxItems: TRPC_MAX_BATCH_SIZE,
      }),
    ],
  });
}
