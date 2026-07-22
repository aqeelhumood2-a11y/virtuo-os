import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const requireCompanyMembershipMock = vi.fn();
const advanceStageMock = vi.fn();

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

vi.mock("@/core", () => ({
  requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
}));

vi.mock("./application/kitchen-display.service", () => ({
  advanceStage: (...args: unknown[]) => advanceStageMock(...args),
  OrderNotFoundError: class OrderNotFoundError extends Error {},
}));

import { advanceStageAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  requireCompanyMembershipMock.mockResolvedValue({
    session: { uid: "uid-1", email: null, superAdmin: false },
    membership: { uid: "uid-1", role: "Employee", branchIds: [], status: "active" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("advanceStageAction", () => {
  const validForm = () => formData({ companyId: "company-1", orderId: "order-1", stage: "preparing", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await advanceStageAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(advanceStageMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid stage value", async () => {
    const result = await advanceStageAction(
      {},
      formData({ companyId: "company-1", orderId: "order-1", stage: "bogus", csrfToken: "valid-csrf-token" }),
    );

    expect(result.error).toBeDefined();
    expect(advanceStageMock).not.toHaveBeenCalled();
  });

  it("calls advanceStage with the actor's own uid and reports success", async () => {
    const result = await advanceStageAction({}, validForm());

    expect(advanceStageMock).toHaveBeenCalledWith("company-1", "order-1", "preparing", "uid-1");
    expect(result.success).toBeDefined();
  });
});
