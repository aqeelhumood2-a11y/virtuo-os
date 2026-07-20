import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUpMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const sendPasswordResetEmailMock = vi.fn();
const toSafeAuthErrorMock = vi.fn((error: unknown) => ({
  code: "MOCKED",
  message: error instanceof Error ? `mapped:${error.message}` : "mapped:unknown",
}));

const checkRateLimitMock = vi.fn((action: string, identifier: string) => {
  void action;
  void identifier;
  return { allowed: true };
});

const createSessionMock = vi.fn();
const clearSessionMock = vi.fn();

const csrfTokensMatchMock = vi.fn();

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

let csrfCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "csrf_token" && csrfCookieValue ? { value: csrfCookieValue } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("./csrf", () => ({
  csrfTokensMatch: (...args: unknown[]) => csrfTokensMatchMock(...args),
}));

vi.mock("./identity-toolkit", () => ({
  signUp: (...args: unknown[]) => signUpMock(...args),
  signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmailMock(...args),
  toSafeAuthError: (error: unknown) => toSafeAuthErrorMock(error),
}));

vi.mock("./rate-limit", () => ({
  checkRateLimit: (action: string, identifier: string) => checkRateLimitMock(action, identifier),
}));

vi.mock("./session", () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  clearSession: (...args: unknown[]) => clearSessionMock(...args),
}));

import {
  requestPasswordResetAction,
  signInAction,
  signOutAction,
  signUpAction,
} from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  checkRateLimitMock.mockReturnValue({ allowed: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("signUpAction", () => {
  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await signUpAction(
      {},
      formData({ email: "a@example.com", password: "password123", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input before calling Identity Toolkit", async () => {
    const result = await signUpAction(
      {},
      formData({ email: "not-an-email", password: "short", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toBeDefined();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("enforces rate limiting before calling Identity Toolkit", async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });
    const result = await signUpAction(
      {},
      formData({ email: "a@example.com", password: "password123", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toMatch(/too many attempts/i);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("creates a session and redirects to /account on success", async () => {
    signUpMock.mockResolvedValue({ idToken: "token-abc", localId: "uid-1" });

    await expect(
      signUpAction(
        {},
        formData({ email: "a@example.com", password: "password123", csrfToken: "valid-csrf-token" }),
      ),
    ).rejects.toThrow("REDIRECT:/account");

    expect(createSessionMock).toHaveBeenCalledWith("token-abc");
  });

  it("maps a failure to a safe message without redirecting", async () => {
    signUpMock.mockRejectedValue(new Error("EMAIL_EXISTS"));

    const result = await signUpAction(
      {},
      formData({ email: "a@example.com", password: "password123", csrfToken: "valid-csrf-token" }),
    );

    expect(result.error).toBe("mapped:EMAIL_EXISTS");
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("signInAction", () => {
  it("never distinguishes wrong-password from no-such-account", async () => {
    toSafeAuthErrorMock.mockReturnValue({ code: "X", message: "Invalid email or password." });
    signInWithPasswordMock.mockRejectedValue(new Error("EMAIL_NOT_FOUND"));

    const resultA = await signInAction(
      {},
      formData({ email: "a@example.com", password: "wrong", csrfToken: "valid-csrf-token" }),
    );

    signInWithPasswordMock.mockRejectedValue(new Error("INVALID_PASSWORD"));
    const resultB = await signInAction(
      {},
      formData({ email: "a@example.com", password: "wrong", csrfToken: "valid-csrf-token" }),
    );

    expect(resultA.error).toBe(resultB.error);
  });

  it("creates a session and redirects to /account on success", async () => {
    signInWithPasswordMock.mockResolvedValue({ idToken: "token-xyz", localId: "uid-1" });

    await expect(
      signInAction(
        {},
        formData({ email: "a@example.com", password: "password123", csrfToken: "valid-csrf-token" }),
      ),
    ).rejects.toThrow("REDIRECT:/account");

    expect(createSessionMock).toHaveBeenCalledWith("token-xyz");
  });

  it("rejects when the CSRF token is missing entirely", async () => {
    const data = new FormData();
    data.set("email", "a@example.com");
    data.set("password", "password123");
    // No csrfToken field at all.
    const result = await signInAction({}, data);
    expect(result.error).toMatch(/session has expired/i);
  });
});

describe("signOutAction", () => {
  it("clears the session and redirects to /login on a valid CSRF token", async () => {
    await expect(
      signOutAction(formData({ csrfToken: "valid-csrf-token" })),
    ).rejects.toThrow("REDIRECT:/login");
    expect(clearSessionMock).toHaveBeenCalledOnce();
  });

  it("fails closed on an invalid CSRF token: does not clear the session", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    await expect(signOutAction(formData({ csrfToken: "wrong" }))).rejects.toThrow(
      "REDIRECT:/account",
    );
    expect(clearSessionMock).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction", () => {
  it("returns the same generic message whether or not the account exists", async () => {
    sendPasswordResetEmailMock.mockResolvedValue(undefined);
    const successResult = await requestPasswordResetAction(
      {},
      formData({ email: "exists@example.com", csrfToken: "valid-csrf-token" }),
    );

    sendPasswordResetEmailMock.mockRejectedValue(new Error("EMAIL_NOT_FOUND"));
    const notFoundResult = await requestPasswordResetAction(
      {},
      formData({ email: "doesnotexist@example.com", csrfToken: "valid-csrf-token" }),
    );

    expect(successResult.success).toBe(notFoundResult.success);
    expect(successResult.error).toBeUndefined();
    expect(notFoundResult.error).toBeUndefined();
  });

  it("enforces rate limiting", async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });
    const result = await requestPasswordResetAction(
      {},
      formData({ email: "a@example.com", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toMatch(/too many attempts/i);
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid CSRF token", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await requestPasswordResetAction(
      {},
      formData({ email: "a@example.com", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });
});
