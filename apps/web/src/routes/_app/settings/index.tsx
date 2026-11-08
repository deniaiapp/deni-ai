import { createFileRoute, notFound } from "@tanstack/react-router";

/** There is no settings overview page; /settings stays a 404 as before. */
export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: () => {
    throw notFound();
  },
});
