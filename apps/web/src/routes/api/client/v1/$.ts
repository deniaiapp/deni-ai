import { createFileRoute } from "@tanstack/react-router";

const handle = async ({ request, params }: { request: Request; params: { _splat?: string } }) =>
  (await import("@/server/http/client-v1/router")).handleClientApi(request, params._splat ?? "");

/** The native client API for Deni AI Desktop (`/api/client/v1/*`); see src/server/http/client-v1/router.ts. */
export const Route = createFileRoute("/api/client/v1/$")({
  server: {
    handlers: { GET: handle, POST: handle, PATCH: handle, PUT: handle, DELETE: handle },
  },
});
