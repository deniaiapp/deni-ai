import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isLocalAuthBypass } from "./lib/local-auth";

const publicExact = new Set([
  "/",
  "/home",
  "/upgrade",
  "/terms",
  "/privacy",
  "/sign-in",
  "/sign-up",
  "/two-factor",
  "/robots.txt",
]);

function isPublicPath(pathname: string) {
  if (publicExact.has(pathname)) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname === "/api/billing/webhook") return true;
  if (pathname === "/api/health") return true;
  return false;
}

export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname) || isLocalAuthBypass(request.headers.get("host"))) return NextResponse.next();

  const sessionCookie = getSessionCookie(request);
  if (sessionCookie) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
