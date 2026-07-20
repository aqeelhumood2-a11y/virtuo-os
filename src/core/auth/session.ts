import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { adminAuth } from "@/lib/firebase/admin";

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./constants";
import type { AuthSession } from "./types";

// Mints a brand-new session cookie from a freshly-obtained ID token. This
// is what "session rotation after authentication" means in practice: every
// successful sign-in/sign-up calls this and gets a distinct cookie value --
// no session token is ever reused across authentication events.
//
// Deliberately does NOT call adminAuth.revokeRefreshTokens() here. Firebase
// compares a session cookie's auth_time against the user's
// tokensValidAfterTime (set by revokeRefreshTokens to "now") when
// checkRevoked is used; revoking at the moment of sign-in risks the
// just-issued token's auth_time landing at or before that timestamp,
// which would immediately invalidate the session just created. Revocation
// is reserved for explicit sign-out, where invalidating everything
// (including the session being ended) is exactly the intent.
export async function createSession(idToken: string): Promise<void> {
  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

// Read-only by design -- Next.js only allows cookies() mutation inside a
// Server Action or Route Handler, and this function is called from Server
// Components too. An invalid, expired, revoked, or tampered cookie all
// fail verifySessionCookie identically and are treated the same way here:
// no session. The stale cookie itself is not proactively cleared (Next
// disallows that outside a mutation context); it is overwritten on the
// next successful sign-in and explicitly deleted on sign-out, and in the
// meantime it can never grant access because it can never verify.
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, /* checkRevoked */ true);
    return { uid: decoded.uid, email: decoded.email ?? null, superAdmin: decoded.superAdmin === true };
  } catch {
    return null;
  }
});

// The authoritative authorization boundary for any protected Server
// Component or Server Action. This -- not proxy.ts -- is what "expired
// session redirect" and "invalid session recovery" mean: any failure mode
// of getSession() (missing, invalid, expired, revoked, or tampered cookie)
// converges on the same safe outcome, a redirect to /login.
export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

// Revokes every refresh token for the user (signs them out everywhere, not
// just this one cookie) before deleting the cookie itself.
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionCookie) {
    try {
      const decoded = await adminAuth.verifySessionCookie(sessionCookie);
      await adminAuth.revokeRefreshTokens(decoded.uid);
    } catch {
      // Already invalid/expired -- nothing valid to revoke.
    }
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
