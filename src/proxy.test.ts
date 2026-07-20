import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(new URL(path, "https://example.com"));
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

describe("proxy", () => {
  it("redirects to /login when accessing a protected route without a session cookie", () => {
    const response = proxy(makeRequest("/account"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/login");
  });

  it("passes through to a protected route when a session cookie is present", () => {
    const response = proxy(makeRequest("/account", { session: "some-cookie-value" }));
    expect(response.headers.get("location")).toBeNull();
  });

  it("does NOT redirect /login based on cookie presence alone (avoids a redirect loop for an invalid cookie)", () => {
    // Deliberate: redirecting /login -> /account purely because *a* session
    // cookie exists (without verifying it) would loop forever against an
    // invalid/expired/tampered cookie, since the protected page's
    // requireSession() would redirect that same request straight back to
    // /login. The authoritative "redirect away if already signed in" check
    // lives in login/page.tsx via getSession() instead. See proxy.ts.
    const response = proxy(makeRequest("/login", { session: "some-cookie-value" }));
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes through /login when there is no session cookie", () => {
    const response = proxy(makeRequest("/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("sets a CSRF cookie when one is missing", () => {
    const response = proxy(makeRequest("/login"));
    const csrfCookie = response.cookies.get("csrf_token");
    expect(csrfCookie?.value).toBeTruthy();
    expect(csrfCookie?.httpOnly).toBe(true);
    expect(csrfCookie?.sameSite).toBe("lax");
  });

  it("does not overwrite an existing CSRF cookie", () => {
    const response = proxy(makeRequest("/login", { csrf_token: "existing-token" }));
    expect(response.cookies.get("csrf_token")).toBeUndefined();
  });

  it("also ensures a CSRF cookie exists on the protected route", () => {
    const response = proxy(makeRequest("/account", { session: "some-cookie-value" }));
    expect(response.cookies.get("csrf_token")?.value).toBeTruthy();
  });

  it("matches nested account paths as protected", () => {
    const response = proxy(makeRequest("/account/anything"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/login");
  });
});
