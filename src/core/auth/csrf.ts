import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

// Double-submit-cookie CSRF defense: proxy.ts issues this token as an
// httpOnly cookie on GET requests to auth-related routes; the Server
// Component that renders the form reads the same cookie and embeds its
// value in a hidden field (no client JS involved). A Server Action then
// compares the submitted field against the cookie -- a cross-site request
// can't read our httpOnly cookie, so it can't produce a matching value.
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function csrfTokensMatch(submitted: string, expected: string): boolean {
  if (!submitted || !expected) return false;

  const submittedBuffer = Buffer.from(submitted);
  const expectedBuffer = Buffer.from(expected);
  if (submittedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(submittedBuffer, expectedBuffer);
}
