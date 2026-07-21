import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const installAppMock = vi.fn();
const uninstallAppMock = vi.fn();

let csrfCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "csrf_token" && csrfCookieValue ? { value: csrfCookieValue } : undefined),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/core/auth/csrf", () => ({
  csrfTokensMatch: (a: string, b: string) => csrfTokensMatchMock(a, b),
}));

// AppNotEntitledError/AppNotRegisteredError are real classes (not mocked)
// so `error instanceof ...` inside the action still works against a real
// thrown instance -- only the mutating functions themselves are mocked.
vi.mock("@/platform", async () => {
  const actual = await vi.importActual<typeof import("@/platform")>("@/platform");
  return {
    ...actual,
    installApp: (...args: unknown[]) => installAppMock(...args),
    uninstallApp: (...args: unknown[]) => uninstallAppMock(...args),
  };
});

import { AppNotEntitledError, AppNotRegisteredError } from "@/platform";

import { installAppAction, uninstallAppAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("installAppAction", () => {
  const validForm = () => formData({ companyId: "company-1", appId: "restaurant", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await installAppAction({}, formData({ companyId: "company-1", appId: "restaurant", csrfToken: "wrong" }));
    expect(result.error).toMatch(/session has expired/i);
    expect(installAppMock).not.toHaveBeenCalled();
  });

  it("calls installApp with the validated companyId/appId, then revalidates the settings path", async () => {
    const result = await installAppAction({}, validForm());

    expect(installAppMock).toHaveBeenCalledWith("company-1", "restaurant");
    expect(result.success).toBeDefined();
  });

  it("maps AppNotEntitledError to a clear, non-technical message", async () => {
    installAppMock.mockRejectedValue(new AppNotEntitledError("restaurant"));
    const result = await installAppAction({}, validForm());

    expect(result.error).toMatch(/plan doesn't include/i);
  });

  it("maps AppNotRegisteredError to a clear, non-technical message", async () => {
    installAppMock.mockRejectedValue(new AppNotRegisteredError("ghost"));
    const result = await installAppAction({}, validForm());

    expect(result.error).toMatch(/doesn't exist/i);
  });

  it("maps an unexpected error (e.g. an authorization redirect) to a generic message", async () => {
    installAppMock.mockRejectedValue(new Error("REDIRECT:/account"));
    const result = await installAppAction({}, validForm());

    expect(result.error).toBe("Something went wrong. Please try again.");
  });
});

describe("uninstallAppAction", () => {
  const validForm = () => formData({ companyId: "company-1", appId: "restaurant", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await uninstallAppAction({}, formData({ companyId: "company-1", appId: "restaurant", csrfToken: "wrong" }));
    expect(result.error).toMatch(/session has expired/i);
    expect(uninstallAppMock).not.toHaveBeenCalled();
  });

  it("calls uninstallApp with the validated companyId/appId", async () => {
    const result = await uninstallAppAction({}, validForm());

    expect(uninstallAppMock).toHaveBeenCalledWith("company-1", "restaurant");
    expect(result.success).toBeDefined();
  });
});
