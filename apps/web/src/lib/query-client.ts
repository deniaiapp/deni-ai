import { QueryClient } from "@tanstack/react-query";

/**
 * React Query's browser default (three retries), except for rate-limit
 * refusals: retrying them inside the same window only spends more of the
 * budget and keeps whatever awaits the refetch waiting about 7 s.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  const data = (error as { data?: { code?: unknown; httpStatus?: unknown } | null } | null)?.data;
  if (data?.code === "TOO_MANY_REQUESTS" || data?.httpStatus === 429) return false;
  return failureCount < 3;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // The server keeps React Query's default of no retries.
        retry: typeof window === "undefined" ? false : shouldRetryQuery,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Canonical Next.js SSR QueryClient factory: new client per server request,
 * singleton in the browser for hydration stability.
 */
export function getQueryClient() {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }

  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }

  return browserQueryClient;
}
