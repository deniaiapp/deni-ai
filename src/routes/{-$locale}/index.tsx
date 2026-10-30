import { createFileRoute, redirect } from "@tanstack/react-router";
import { homeHead } from "@/components/home/home-head";
import { HomePage } from "@/components/home/home-page";

/**
 * `/` sends visitors to `/home` (document requests are redirected earlier by the
 * request middleware); `/ja` is the Japanese homepage itself.
 */
export const Route = createFileRoute("/{-$locale}/")({
  beforeLoad: ({ params }) => {
    if (params.locale === undefined) {
      throw redirect({ href: "/home" });
    }
  },
  head: ({ match }) => homeHead(match.context.intl.locale),
  component: LocaleHomeRoute,
});

function LocaleHomeRoute() {
  return <HomePage />;
}
