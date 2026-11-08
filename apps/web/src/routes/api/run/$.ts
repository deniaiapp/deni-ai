import { createFileRoute } from "@tanstack/react-router";

const handle = async ({ request, params }: { request: Request; params: { _splat?: string } }) =>
  (await import("@/server/http/run/router")).handleRunApi(request, params._splat ?? "");

/** Run mode's API (`/api/run/*`); see src/server/http/run/router.ts. */
export const Route = createFileRoute("/api/run/$")({
  server: {
    handlers: { GET: handle, POST: handle, PATCH: handle, PUT: handle, DELETE: handle },
  },
});
