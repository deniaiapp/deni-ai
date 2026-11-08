import { createFileRoute } from "@tanstack/react-router";
import { homeHead } from "@/components/home/home-head";
import { HomePage } from "@/components/home/home-page";

export const Route = createFileRoute("/{-$locale}/home")({
  head: ({ match }) => homeHead(match.context.intl.locale),
  component: HomeRoute,
});

function HomeRoute() {
  return <HomePage />;
}
