import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const checkRateLimitMock = vi.fn((action: string, identifier: string) => {
  void action;
  void identifier;
  return { allowed: true };
});
const requireSessionMock = vi.fn();
const runOnboardingTransactionMock = vi.fn();
const updateCompanyNameMock = vi.fn();
const setCompanyStatusMock = vi.fn();
const updateCompanyBrandingMock = vi.fn();
const revalidatePathMock = vi.fn();
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

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("./company", () => ({
  updateCompanyName: (...args: unknown[]) => updateCompanyNameMock(...args),
  setCompanyStatus: (...args: unknown[]) => setCompanyStatusMock(...args),
}));

vi.mock("./company-settings", () => ({
  updateCompanyBranding: (...args: unknown[]) => updateCompanyBrandingMock(...args),
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

import { createCompanyAction, suspendCompanyAction, updateBrandingAction, updateCompanyAction } from "./actions";
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

describe("updateCompanyAction", () => {
  const validForm = () => formData({ companyId: "company-1", name: "New Name", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await updateCompanyAction({}, validForm());
    expect(result.error).toMatch(/session has expired/i);
    expect(updateCompanyNameMock).not.toHaveBeenCalled();
  });

  it("rejects an empty name before calling updateCompanyName", async () => {
    const result = await updateCompanyAction(
      {},
      formData({ companyId: "company-1", name: "", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toMatch(/company name/i);
    expect(updateCompanyNameMock).not.toHaveBeenCalled();
  });

  it("calls updateCompanyName with the validated companyId/name, then revalidates /account", async () => {
    const result = await updateCompanyAction({}, validForm());

    expect(updateCompanyNameMock).toHaveBeenCalledWith("company-1", "New Name");
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(result.success).toBeDefined();
  });

  it("maps an unexpected error (e.g. a capability rejection) to a generic message", async () => {
    updateCompanyNameMock.mockRejectedValue(new Error("Forbidden"));
    const result = await updateCompanyAction({}, validForm());

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(result.error).not.toContain("Forbidden");
  });
});

describe("suspendCompanyAction", () => {
  const validForm = (status: string) =>
    formData({ companyId: "company-1", status, csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await suspendCompanyAction({}, validForm("suspended"));
    expect(result.error).toMatch(/session has expired/i);
    expect(setCompanyStatusMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value before calling setCompanyStatus", async () => {
    const result = await suspendCompanyAction({}, validForm("archived"));
    expect(result.error).toBe("Invalid request.");
    expect(setCompanyStatusMock).not.toHaveBeenCalled();
  });

  it("suspends the company and reports a suspended-specific success message", async () => {
    const result = await suspendCompanyAction({}, validForm("suspended"));

    expect(setCompanyStatusMock).toHaveBeenCalledWith("company-1", "suspended");
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(result.success).toMatch(/suspended/i);
  });

  it("reactivates the company and reports a reactivated-specific success message", async () => {
    const result = await suspendCompanyAction({}, validForm("active"));

    expect(setCompanyStatusMock).toHaveBeenCalledWith("company-1", "active");
    expect(result.success).toMatch(/reactivated/i);
  });

  it("maps an unexpected error (e.g. a capability rejection) to a generic message", async () => {
    setCompanyStatusMock.mockRejectedValue(new Error("Forbidden"));
    const result = await suspendCompanyAction({}, validForm("suspended"));

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(result.error).not.toContain("Forbidden");
  });
});

describe("updateBrandingAction", () => {
  const validForm = (fields: Record<string, string> = {}) =>
    formData({
      companyId: "company-1",
      logoUrl: "https://x.test/logo.png",
      primaryColor: "#336699",
      csrfToken: "valid-csrf-token",
      ...fields,
    });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await updateBrandingAction({}, validForm());
    expect(result.error).toMatch(/session has expired/i);
    expect(updateCompanyBrandingMock).not.toHaveBeenCalled();
  });

  it("rejects a primaryColor that isn't a hex color", async () => {
    const result = await updateBrandingAction({}, validForm({ primaryColor: "blue" }));
    expect(result.error).toMatch(/hex color/i);
    expect(updateCompanyBrandingMock).not.toHaveBeenCalled();
  });

  it("treats blank fields as omitted rather than a validation failure", async () => {
    const result = await updateBrandingAction({}, validForm({ logoUrl: "", primaryColor: "" }));
    expect(updateCompanyBrandingMock).toHaveBeenCalledWith("company-1", { logoUrl: undefined, primaryColor: undefined });
    expect(result.success).toBeDefined();
  });

  it("calls updateCompanyBranding with the validated fields, then revalidates the settings path", async () => {
    const result = await updateBrandingAction({}, validForm());

    expect(updateCompanyBrandingMock).toHaveBeenCalledWith("company-1", {
      logoUrl: "https://x.test/logo.png",
      primaryColor: "#336699",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/company-1/settings");
    expect(result.success).toBeDefined();
  });

  it("maps an unexpected error (e.g. a capability rejection) to a generic message", async () => {
    updateCompanyBrandingMock.mockRejectedValue(new Error("Forbidden"));
    const result = await updateBrandingAction({}, validForm());

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(result.error).not.toContain("Forbidden");
  });
});
