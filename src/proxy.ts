import { NextResponse, type NextRequest } from "next/server";

import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/core/auth/constants";
import { generateCsrfToken } from "@/core/auth/csrf";

// Next.js 16 renamed Middleware to Proxy (same file convention, same
// capabilities, now Node.js runtime by default). This check is
// deliberately optimistic: it only reads whether a session cookie is
// *present*, never cryptographically verifies it (that requires an async
// Admin SDK call, and Proxy runs on every request including prefetches).
// The authoritative check is core/auth/session.ts's requireSession(),
// called server-side wherever it actually matters.
//
// Only the "no cookie -> redirect away from a protected route" direction
// lives here. The reverse ("cookie present -> redirect away from the auth
// pages") is deliberately NOT done by presence alone: a present-but-invalid
// cookie (expired/revoked/tampered) would otherwise bounce a user in an
// infinite loop -- account/page.tsx's requireSession() redirects it to
// /login because the cookie doesn't verify, while a presence-only check
// here would immediately redirect /login back to /account. That loop was
// caught during Phase 1B's manual verification. Each auth page instead
// calls the authoritative getSession() itself (a read-only call, legal in
// a Server Component) to decide whether to redirect to /account.
const PROTECTED_ROUTES = ["/account"];
const CSRF_ROUTES = ["/account", "/login", "/register", "/reset-password"];

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (matchesRoute(pathname, PROTECTED_ROUTES) && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.next();

  // Ensure a CSRF token cookie exists on every route Proxy runs on, so the
  // Server Components that render auth forms (and the protected /account
  // page, whose sign-out form is also CSRF-protected) can always read one.
  if (matchesRoute(pathname, CSRF_ROUTES) && !request.cookies.get(CSRF_COOKIE_NAME)?.value) {
    response.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }

  return response;
}

export const config = {
  matcher: ["/account", "/account/:path*", "/login", "/register", "/reset-password"],
};
