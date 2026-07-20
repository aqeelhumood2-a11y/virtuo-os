import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const checkRateLimitMock = vi.fn((action: string, identifier: string) => {
  void action;
  void identifier;
  return { allowed: true };
});
const requireSessionMock = vi.fn();
const runOnboardingTransactionMock = vi.fn();
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

vi.mock("@/core/auth/csrf", () => ({
  csrfTokensMatch: (...args: unknown[]) => csrfTokensMatchMock(...args),
}));

vi.mock("@/core/auth/rate-limit", () => ({
  checkRateLimit: (action: string, identifier: string) => checkRateLimitMock(action, identifier),
}));

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("./onboarding", async () => {
  const actual = await vi.importActual<typeof import("./onboarding")>("./onboarding");
  return {
    AlreadyOnboardedError: actual.AlreadyOnboardedError,
    runOnboardingTransaction: (...args: unknown[]) => runOnboardingTransactionMock(...args),
  };
});

import { createCompanyAction } from "./actions";
import { AlreadyOnboardedError } from "./onboarding";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  checkRateLimitMock.mockReturnValue({ allowed: true });
  requireSessionMock.mockResolvedValue({ uid: "uid-1", email: "a@example.com" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createCompanyAction", () => {
  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await createCompanyAction(
      {},
      formData({ companyName: "Acme", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(runOnboardingTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input before calling the transaction", async () => {
    const result = await createCompanyAction({}, formData({ companyName: "", csrfToken: "valid-csrf-token" }));
    expect(result.error).toMatch(/company name/i);
    expect(runOnboardingTransactionMock).not.toHaveBeenCalled();
  });

  it("enforces rate limiting before calling the transaction", async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });
    const result = await createCompanyAction(
      {},
      formData({ companyName: "Acme", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toMatch(/too many attempts/i);
    expect(runOnboardingTransactionMock).not.toHaveBeenCalled();
  });

  it("runs the transaction with the session uid/email and the validated name, then redirects", async () => {
    runOnboardingTransactionMock.mockResolvedValue({ companyId: "c1", branchId: "b1" });

    await expect(
      createCompanyAction({}, formData({ companyName: "  Acme  ", csrfToken: "valid-csrf-token" })),
    ).rejects.toThrow("REDIRECT:/account");

    expect(runOnboardingTransactionMock).toHaveBeenCalledWith({
      uid: "uid-1",
      email: "a@example.com",
      companyName: "Acme",
    });
  });

  it("maps AlreadyOnboardedError to a clear, non-technical message", async () => {
    runOnboardingTransactionMock.mockRejectedValue(new AlreadyOnboardedError());

    const result = await createCompanyAction(
      {},
      formData({ companyName: "Acme", csrfToken: "valid-csrf-token" }),
    );

    expect(result.error).toMatch(/already belong to a company/i);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("maps an unexpected error to a generic message without leaking details", async () => {
    runOnboardingTransactionMock.mockRejectedValue(new Error("some internal Firestore detail"));

    const result = await createCompanyAction(
      {},
      formData({ companyName: "Acme", csrfToken: "valid-csrf-token" }),
    );

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(result.error).not.toContain("internal Firestore detail");
  });
});
