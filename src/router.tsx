import { createRouter } from "@tanstack/react-router";
import { ErrorPage } from "@/components/common/error-page";
import { NotFound } from "@/components/common/not-found";
import { RouteLoading } from "@/components/common/route-loading";
import { routeTree } from "@/routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingComponent: RouteLoading,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
