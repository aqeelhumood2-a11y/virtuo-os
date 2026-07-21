import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const enrollMemberMock = vi.fn();
const attributeOrderToMemberMock = vi.fn();
const syncAccrualsMock = vi.fn();
const requireCompanyMembershipMock = vi.fn();

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

vi.mock("@/core", async () => {
  const actual = await vi.importActual<typeof import("@/core")>("@/core");
  return {
    ...actual,
    requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
  };
});

vi.mock("./application/loyalty.service", () => ({
  enrollMember: (...args: unknown[]) => enrollMemberMock(...args),
  attributeOrderToMember: (...args: unknown[]) => attributeOrderToMemberMock(...args),
  syncAccruals: (...args: unknown[]) => syncAccrualsMock(...args),
}));

import { MemberNotFoundError } from "./domain/errors";
import { attributeOrderAction, enrollMemberAction, syncAccrualsAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  requireCompanyMembershipMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  syncAccrualsMock.mockResolvedValue({ processedCount: 0, accruedCount: 0, skippedCount: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("enrollMemberAction", () => {
  const validForm = () =>
    formData({ csrfToken: "valid-csrf-token", companyId: "company-1", name: "Jane Doe", contactRef: "jane@x.com" });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await enrollMemberAction({}, validForm());

    expect(result.error).toMatch(/session has expired/i);
    expect(enrollMemberMock).not.toHaveBeenCalled();
  });

  it("resolves the actor via requireCompanyMembership, then enrolls the member", async () => {
    const result = await enrollMemberAction({}, validForm());

    expect(enrollMemberMock).toHaveBeenCalledWith("company-1", "owner-1", { name: "Jane Doe", contactRef: "jane@x.com" });
    expect(result.success).toBeDefined();
  });

  it("rejects a missing name", async () => {
    const form = validForm();
    form.delete("name");
    const result = await enrollMemberAction({}, form);

    expect(result.error).toBe("Invalid request.");
    expect(enrollMemberMock).not.toHaveBeenCalled();
  });
});

describe("attributeOrderAction", () => {
  const validForm = () =>
    formData({ csrfToken: "valid-csrf-token", companyId: "company-1", orderId: "order-1", memberId: "member-1" });

  it("calls attributeOrderToMember with the validated fields and the actor", async () => {
    const result = await attributeOrderAction({}, validForm());

    expect(attributeOrderToMemberMock).toHaveBeenCalledWith("company-1", "order-1", "member-1", "owner-1");
    expect(result.success).toBeDefined();
  });

  it("maps a thrown domain error to its own message", async () => {
    attributeOrderToMemberMock.mockRejectedValue(new MemberNotFoundError());
    const result = await attributeOrderAction({}, validForm());

    expect(result.error).toMatch(/member not found/i);
  });
});

describe("syncAccrualsAction", () => {
  it("calls syncAccruals and reports the result counts", async () => {
    syncAccrualsMock.mockResolvedValue({ processedCount: 3, accruedCount: 2, skippedCount: 1 });
    const result = await syncAccrualsAction({}, formData({ csrfToken: "valid-csrf-token", companyId: "company-1" }));

    expect(syncAccrualsMock).toHaveBeenCalledWith("company-1");
    expect(result.success).toMatch(/2 accrued, 1 skipped/);
  });

  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await syncAccrualsAction({}, formData({ csrfToken: "wrong", companyId: "company-1" }));

    expect(result.error).toMatch(/session has expired/i);
    expect(syncAccrualsMock).not.toHaveBeenCalled();
  });
});
