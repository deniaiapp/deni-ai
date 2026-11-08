import { createFileRoute, notFound, Outlet, redirect } from "@tanstack/react-router";
import Footer from "@/components/footer";
import Header from "@/components/header";
import { RuntimeAppProviders } from "@/components/runtime-app-providers";
import { Spinner } from "@/components/ui/spinner";
import { getPreferredLocale } from "@/i18n/locale";
import { isPublicLocalizablePath, localizedPath } from "@/lib/locale-path";

/**
 * Public marketing pages. `/ja/*` renders them in Japanese; unprefixed URLs are
 * English, and visitors who chose Japanese are sent to the `/ja` copy.
 */
export const Route = createFileRoute("/{-$locale}")({
  beforeLoad: ({ params, location }) => {
    if (params.locale !== undefined && params.locale !== "ja") {
      throw notFound();
    }
    // Document requests are redirected by the request middleware; this covers
    // client navigations.
    if (
      params.locale === undefined &&
      isPublicLocalizablePath(location.pathname) &&
      getPreferredLocale() === "ja"
    ) {
      throw redirect({ href: `${localizedPath(location.pathname, "ja")}${location.searchStr}` });
    }
  },
  pendingComponent: MarketingPending,
  component: MarketingLayout,
});

function MarketingPending() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

function MarketingLayout() {
  return (
    <RuntimeAppProviders>
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </RuntimeAppProviders>
  );
}
