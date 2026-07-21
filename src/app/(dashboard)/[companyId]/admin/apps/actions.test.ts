import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const forceToggleAppMock = vi.fn();

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

vi.mock("@/platform", () => ({
  forceToggleApp: (...args: unknown[]) => forceToggleAppMock(...args),
}));

import { forceToggleAppAction } from "./actions";

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

describe("forceToggleAppAction", () => {
  const validForm = (enabled = "true") =>
    formData({ companyId: "company-1", appId: "restaurant", enabled, csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await forceToggleAppAction(
      {},
      formData({ companyId: "company-1", appId: "restaurant", enabled: "true", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(forceToggleAppMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid enabled value before calling forceToggleApp", async () => {
    const result = await forceToggleAppAction(
      {},
      formData({ companyId: "company-1", appId: "restaurant", enabled: "maybe", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toBe("Invalid request.");
    expect(forceToggleAppMock).not.toHaveBeenCalled();
  });

  it("calls forceToggleApp with the parsed boolean enabled value", async () => {
    const result = await forceToggleAppAction({}, validForm("true"));

    expect(forceToggleAppMock).toHaveBeenCalledWith("company-1", "restaurant", true);
    expect(result.success).toBeDefined();
  });

  it("parses enabled: false correctly", async () => {
    await forceToggleAppAction({}, validForm("false"));

    expect(forceToggleAppMock).toHaveBeenCalledWith("company-1", "restaurant", false);
  });

  it("maps an unexpected error (e.g. a non-Super-Admin redirect) to a generic message", async () => {
    forceToggleAppMock.mockRejectedValue(new Error("REDIRECT:/account"));
    const result = await forceToggleAppAction({}, validForm());

    expect(result.error).toBe("Something went wrong. Please try again.");
  });
});
