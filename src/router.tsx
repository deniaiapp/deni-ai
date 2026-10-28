import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter } from "@tanstack/react-router";
import { Spinner } from "@/components/ui/spinner";
import { getSentryOptions } from "@/lib/sentry-options";
import { routeTree } from "./routeTree.gen";

/**
 * Search params stay plain strings, as with URLSearchParams: no JSON coercion of
 * values like `?page=2`, and hrefs built by hand round-trip unchanged.
 */
function parseSearch(searchStr: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(searchStr));
}

function stringifySearch(search: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Shown while a route loader runs (the old `loading.tsx` fallback). */
function DefaultPending() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

let sentryInitialized = false;

export function getRouter() {
  const router = createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingComponent: DefaultPending,
  });

  if (!router.isServer && !sentryInitialized) {
    sentryInitialized = true;
    const options = getSentryOptions();
    Sentry.init({
      ...options,
      integrations: [
        ...(Array.isArray(options.integrations) ? options.integrations : []),
        Sentry.tanstackRouterBrowserTracingIntegration(router),
      ],
    });
  }

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
