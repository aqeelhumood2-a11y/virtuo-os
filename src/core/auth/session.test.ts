import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockCookieStore = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  _store: Map<string, string>;
};

function createMockCookieStore(): MockCookieStore {
  const store = new Map<string, string>();
  return {
    get: vi.fn((name: string) => (store.has(name) ? { value: store.get(name)! } : undefined)),
    set: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      store.delete(name);
    }),
    _store: store,
  };
}

const createSessionCookieMock = vi.fn();
const verifySessionCookieMock = vi.fn();
const revokeRefreshTokensMock = vi.fn();
const cookiesMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: {
    createSessionCookie: (...args: unknown[]) => createSessionCookieMock(...args),
    verifySessionCookie: (...args: unknown[]) => verifySessionCookieMock(...args),
    revokeRefreshTokens: (...args: unknown[]) => revokeRefreshTokensMock(...args),
  },
}));

vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => cookiesMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirectMock(...args),
}));

describe("session", () => {
  let mockCookieStore: MockCookieStore;

  beforeEach(() => {
    mockCookieStore = createMockCookieStore();
    cookiesMock.mockResolvedValue(mockCookieStore);
    vi.resetModules();
  });

  afterEach(() => {
    createSessionCookieMock.mockReset();
    verifySessionCookieMock.mockReset();
    revokeRefreshTokensMock.mockReset();
    redirectMock.mockClear();
  });

  describe("createSession", () => {
    it("mints a fresh cookie with the correct attributes", async () => {
      createSessionCookieMock.mockResolvedValue("fresh-session-cookie");
      const { createSession } = await import("./session");

      await createSession("id-token-abc");

      expect(createSessionCookieMock).toHaveBeenCalledWith("id-token-abc", {
        expiresIn: expect.any(Number),
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "session",
        "fresh-session-cookie",
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
        }),
      );
    });

    it("issues a distinct cookie value on every call (rotation)", async () => {
      createSessionCookieMock.mockResolvedValueOnce("cookie-1").mockResolvedValueOnce("cookie-2");
      const { createSession } = await import("./session");

      await createSession("token-1");
      const first = mockCookieStore._store.get("session");
      await createSession("token-2");
      const second = mockCookieStore._store.get("session");

      expect(first).toBe("cookie-1");
      expect(second).toBe("cookie-2");
      expect(first).not.toBe(second);
    });
  });

  describe("getSession", () => {
    it("returns null when no cookie is present (missing cookie)", async () => {
      const { getSession } = await import("./session");
      await expect(getSession()).resolves.toBeNull();
      expect(verifySessionCookieMock).not.toHaveBeenCalled();
    });

    it("returns the uid/email on a valid cookie", async () => {
      mockCookieStore._store.set("session", "valid-cookie");
      verifySessionCookieMock.mockResolvedValue({ uid: "uid-1", email: "a@example.com" });
      const { getSession } = await import("./session");

      await expect(getSession()).resolves.toEqual({ uid: "uid-1", email: "a@example.com" });
      expect(verifySessionCookieMock).toHaveBeenCalledWith("valid-cookie", true);
    });

    it("returns null on an invalid/tampered cookie", async () => {
      mockCookieStore._store.set("session", "tampered-cookie");
      verifySessionCookieMock.mockRejectedValue(new Error("auth/argument-error"));
      const { getSession } = await import("./session");

      await expect(getSession()).resolves.toBeNull();
    });

    it("returns null on an expired cookie", async () => {
      mockCookieStore._store.set("session", "expired-cookie");
      verifySessionCookieMock.mockRejectedValue(new Error("auth/session-cookie-expired"));
      const { getSession } = await import("./session");

      await expect(getSession()).resolves.toBeNull();
    });

    it("returns null on a revoked cookie", async () => {
      mockCookieStore._store.set("session", "revoked-cookie");
      verifySessionCookieMock.mockRejectedValue(new Error("auth/session-cookie-revoked"));
      const { getSession } = await import("./session");

      await expect(getSession()).resolves.toBeNull();
    });

    // Note: getSession is wrapped in React's cache(), which dedupes calls
    // within a single React render pass via request-scoped context that
    // only exists inside React's own rendering pipeline. Calling it
    // directly here (outside any render) does not exercise that
    // dedup behavior, so it isn't asserted on in this unit test -- the
    // wrapping itself is a one-line, low-risk usage of a documented React
    // API, not custom logic that needs its own coverage.
  });

  describe("requireSession", () => {
    it("returns the session when valid", async () => {
      mockCookieStore._store.set("session", "valid-cookie");
      verifySessionCookieMock.mockResolvedValue({ uid: "uid-1", email: null });
      const { requireSession } = await import("./session");

      await expect(requireSession()).resolves.toEqual({ uid: "uid-1", email: null });
    });

    it("redirects to /login when there is no valid session", async () => {
      const { requireSession } = await import("./session");

      await expect(requireSession()).rejects.toThrow("REDIRECT:/login");
      expect(redirectMock).toHaveBeenCalledWith("/login");
    });
  });

  describe("clearSession", () => {
    it("revokes refresh tokens and deletes the cookie", async () => {
      mockCookieStore._store.set("session", "valid-cookie");
      verifySessionCookieMock.mockResolvedValue({ uid: "uid-1", email: null });
      const { clearSession } = await import("./session");

      await clearSession();

      expect(revokeRefreshTokensMock).toHaveBeenCalledWith("uid-1");
      expect(mockCookieStore.delete).toHaveBeenCalledWith("session");
    });

    it("still deletes the cookie when it was already invalid", async () => {
      mockCookieStore._store.set("session", "already-invalid");
      verifySessionCookieMock.mockRejectedValue(new Error("auth/session-cookie-expired"));
      const { clearSession } = await import("./session");

      await expect(clearSession()).resolves.toBeUndefined();
      expect(revokeRefreshTokensMock).not.toHaveBeenCalled();
      expect(mockCookieStore.delete).toHaveBeenCalledWith("session");
    });

    it("does nothing to revoke when there was no cookie at all", async () => {
      const { clearSession } = await import("./session");

      await clearSession();

      expect(verifySessionCookieMock).not.toHaveBeenCalled();
      expect(revokeRefreshTokensMock).not.toHaveBeenCalled();
      expect(mockCookieStore.delete).toHaveBeenCalledWith("session");
    });
  });
});
