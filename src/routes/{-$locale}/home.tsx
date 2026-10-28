import { createFileRoute } from "@tanstack/react-router";
import { homeHead } from "@/components/home/home-head";
import { HomePage } from "@/components/home/home-page";
import { getFeaturedBlogPostFn } from "@/lib/blog/blog-functions";

export const Route = createFileRoute("/{-$locale}/home")({
  loader: ({ context }) => getFeaturedBlogPostFn({ data: { locale: context.intl.locale } }),
  head: ({ match }) => homeHead(match.context.intl.locale),
  component: HomeRoute,
});

function HomeRoute() {
  return <HomePage featuredPost={Route.useLoaderData()} />;
}
