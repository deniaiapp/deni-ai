import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/upgrade",
  "/terms",
  "/privacy",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/billing/webhook",
  "/api/health",
  "/robots.txt",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
