import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validClientEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "test-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "test-project",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "test.firebasestorage.app",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:abc123",
};

describe("identity-toolkit", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(validClientEnv)) {
      vi.stubEnv(key, value);
    }
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("signUp sends the expected request and returns the credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { idToken: "token-123", localId: "uid-123" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { signUp } = await import("./identity-toolkit");
    const result = await signUp("a@example.com", "password123");

    expect(result).toEqual({ idToken: "token-123", localId: "uid-123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("accounts:signUp");
    expect(url).toContain("key=test-api-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ email: "a@example.com", password: "password123" });
  });

  it("signInWithPassword throws IdentityToolkitError with the parsed Firebase code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, { error: { code: 400, message: "INVALID_LOGIN_CREDENTIALS" } }),
      ),
    );

    const { signInWithPassword, IdentityToolkitError } = await import("./identity-toolkit");

    await expect(signInWithPassword("a@example.com", "wrong")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof IdentityToolkitError && error.firebaseCode === "INVALID_LOGIN_CREDENTIALS",
    );
  });

  it("strips human-readable detail from the Firebase error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: { code: 400, message: "WEAK_PASSWORD : Password should be at least 6 characters" },
        }),
      ),
    );

    const { signUp, IdentityToolkitError } = await import("./identity-toolkit");

    await expect(signUp("a@example.com", "123")).rejects.toSatisfy(
      (error: unknown) => error instanceof IdentityToolkitError && error.firebaseCode === "WEAK_PASSWORD",
    );
  });

  it("sendPasswordResetEmail resolves on success and throws on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { email: "a@example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendPasswordResetEmail } = await import("./identity-toolkit");
    await expect(sendPasswordResetEmail("a@example.com")).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("accounts:sendOobCode");
    expect(JSON.parse(init.body)).toMatchObject({
      requestType: "PASSWORD_RESET",
      email: "a@example.com",
    });
  });

  describe("toSafeAuthError", () => {
    it.each([
      ["EMAIL_EXISTS", "An account with this email already exists."],
      ["EMAIL_NOT_FOUND", "Invalid email or password."],
      ["INVALID_PASSWORD", "Invalid email or password."],
      ["INVALID_LOGIN_CREDENTIALS", "Invalid email or password."],
      ["WEAK_PASSWORD", "Password should be at least 6 characters."],
      ["INVALID_EMAIL", "Please enter a valid email address."],
      ["USER_DISABLED", "This account has been disabled."],
      ["TOO_MANY_ATTEMPTS_TRY_LATER", "Too many attempts. Please try again later."],
    ])("maps %s to a safe message", async (code, expectedMessage) => {
      const { toSafeAuthError, IdentityToolkitError } = await import("./identity-toolkit");
      expect(toSafeAuthError(new IdentityToolkitError(code)).message).toBe(expectedMessage);
    });

    it("never leaks an unmapped or raw error", async () => {
      const { toSafeAuthError, IdentityToolkitError } = await import("./identity-toolkit");

      const unmapped = toSafeAuthError(new IdentityToolkitError("SOME_INTERNAL_DETAIL_12345"));
      expect(unmapped.message).toBe("Something went wrong. Please try again.");
      expect(unmapped.message).not.toContain("SOME_INTERNAL_DETAIL_12345");

      const nonFirebaseError = toSafeAuthError(new Error("ECONNREFUSED 127.0.0.1:443"));
      expect(nonFirebaseError.message).toBe("Something went wrong. Please try again.");
      expect(nonFirebaseError.message).not.toContain("ECONNREFUSED");
    });
  });
});
