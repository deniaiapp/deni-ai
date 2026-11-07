import { redirect } from "@tanstack/react-router";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getSessionCookie } from "better-auth/cookies";
import { isLocalAuthBypass } from "@/lib/auth/local";

const publicExact = new Set([
  "/",
  "/home",
  "/upgrade",
  "/terms",
  "/privacy",
  "/support",
  "/integrations",
  "/sign-in",
  "/sign-up",
  "/two-factor",
  "/robots.txt",
]);

function isPublicPath(pathname: string) {
  if (publicExact.has(pathname)) return true;
  if (pathname.startsWith("/integrations/")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname === "/api/health") return true;
  // Checks the session itself; in development it first hands tunnel callbacks back to localhost.
  if (pathname === "/api/mcp/oauth/callback") return true;
  // Static files are served before the app; anything with an extension that reaches it is not a page.
  if (/\.[^/]+$/.test(pathname)) return true;
  return false;
}

// Sends signed-out visitors to the sign-in page and answers 401 for the API. This only checks that
// a session cookie exists; every page loader, server function, and API route still checks the
// session itself. Server functions are left to those checks because public pages call them too.
const sessionGate = createMiddleware().server(async ({ next, request, handlerType }) => {
  if (handlerType === "serverFn") return next();
  const { pathname } = new URL(request.url);
  if (isPublicPath(pathname) || isLocalAuthBypass(request.headers.get("host"))) return next();
  if (getSessionCookie(request)) return next();
  if (pathname.startsWith("/api/")) throw Response.json({ error: "Unauthorized" }, { status: 401 });
  throw redirect({ to: "/sign-in" });
});

const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, sessionGate],
}));
