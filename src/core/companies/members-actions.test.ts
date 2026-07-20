import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const outranksMock = vi.fn();
const getMembershipMock = vi.fn();
const isLastActiveOwnerMock = vi.fn();
const updateMembershipRoleInTransactionMock = vi.fn();
const deactivateMembershipInTransactionMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();
const createNotificationInTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();

let csrfCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "csrf_token" && csrfCookieValue ? { value: csrfCookieValue } : undefined),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/core/auth/csrf", () => ({
  csrfTokensMatch: (a: string, b: string) => a === b,
}));

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
  outranks: (...args: unknown[]) => outranksMock(...args),
}));

vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("@/core/notifications", () => ({
  createNotificationInTransaction: (...args: unknown[]) => createNotificationInTransactionMock(...args),
}));

vi.mock("./membership", () => ({
  getMembership: (...args: unknown[]) => getMembershipMock(...args),
  isLastActiveOwner: (...args: unknown[]) => isLastActiveOwnerMock(...args),
  updateMembershipRoleInTransaction: (...args: unknown[]) => updateMembershipRoleInTransactionMock(...args),
  deactivateMembershipInTransaction: (...args: unknown[]) => deactivateMembershipInTransactionMock(...args),
}));

// The mutation, its audit log entry, and the affected member's notification
// all commit inside one adminDb.runTransaction() call (1G) -- a fake
// transaction object is enough here since the transaction-composable
// primitives above are all mocked out too.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    runTransaction: async (fn: (t: unknown) => Promise<void> | void) => fn({}),
  },
}));

import { deactivateMemberAction, updateMemberRoleAction } from "./members-actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  requireCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: "a@example.com", superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  getMembershipMock.mockResolvedValue({ uid: "target-1", role: "Employee", branchIds: [], status: "active" });
  isLastActiveOwnerMock.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateMemberRoleAction", () => {
  const validForm = () =>
    formData({ companyId: "company-1", targetUid: "target-1", role: "Manager", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    const result = await updateMemberRoleAction({}, formData({ companyId: "company-1", targetUid: "target-1", role: "Manager", csrfToken: "wrong" }));
    expect(result.error).toMatch(/session has expired/i);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input before checking capability", async () => {
    const result = await updateMemberRoleAction({}, formData({ companyId: "company-1", targetUid: "target-1", role: "Wizard", csrfToken: "valid-csrf-token" }));
    expect(result.error).toBe("Invalid request.");
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it("requires the membership.updateRole capability, scoped to the submitted companyId", async () => {
    await updateMemberRoleAction({}, validForm());
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "membership.updateRole");
  });

  it("rejects when the target member is not found", async () => {
    getMembershipMock.mockResolvedValue(null);
    const result = await updateMemberRoleAction({}, validForm());
    expect(result.error).toMatch(/could not be found/i);
    expect(updateMembershipRoleInTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects demoting the only active Owner", async () => {
    isLastActiveOwnerMock.mockResolvedValue(true);
    const result = await updateMemberRoleAction({}, validForm());
    expect(result.error).toMatch(/only active owner/i);
    expect(updateMembershipRoleInTransactionMock).not.toHaveBeenCalled();
  });

  it("allows reassigning Owner to Owner even if they are the only Owner", async () => {
    isLastActiveOwnerMock.mockResolvedValue(true);
    const result = await updateMemberRoleAction(
      {},
      formData({ companyId: "company-1", targetUid: "target-1", role: "Owner", csrfToken: "valid-csrf-token" }),
    );
    expect(result.success).toBeDefined();
    expect(updateMembershipRoleInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      "target-1",
      "Owner",
    );
  });

  it("updates the role, writes an audit log entry, notifies the target, and revalidates /account on success", async () => {
    const result = await updateMemberRoleAction({}, validForm());
    expect(updateMembershipRoleInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      "target-1",
      "Manager",
    );
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorId: "owner-1",
        action: "membership.roleUpdated",
        targetType: "membership",
        targetId: "target-1",
        before: { role: "Employee" },
        after: { role: "Manager" },
      }),
    );
    expect(createNotificationInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "target-1",
      expect.objectContaining({ relatedEntity: { type: "membership", id: "target-1" } }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(result.success).toBeDefined();
  });
});

describe("deactivateMemberAction", () => {
  const validForm = () => formData({ companyId: "company-1", targetUid: "target-1", csrfToken: "valid-csrf-token" });

  it("rejects when the CSRF token does not match", async () => {
    const result = await deactivateMemberAction({}, formData({ companyId: "company-1", targetUid: "target-1", csrfToken: "wrong" }));
    expect(result.error).toMatch(/session has expired/i);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it("requires the membership.deactivate capability", async () => {
    outranksMock.mockReturnValue(true);
    await deactivateMemberAction({}, validForm());
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "membership.deactivate");
  });

  it("rejects when the target member is not found", async () => {
    getMembershipMock.mockResolvedValue(null);
    const result = await deactivateMemberAction({}, validForm());
    expect(result.error).toMatch(/could not be found/i);
    expect(deactivateMembershipInTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects when a non-Owner actor targets an equal-or-higher-ranked member", async () => {
    requireCapabilityMock.mockResolvedValue({
      session: { uid: "manager-1", email: null, superAdmin: false },
      membership: { uid: "manager-1", role: "Manager", branchIds: [], status: "active" },
    });
    getMembershipMock.mockResolvedValue({ uid: "target-1", role: "Manager", branchIds: [], status: "active" });
    outranksMock.mockReturnValue(false);

    const result = await deactivateMemberAction({}, validForm());
    expect(result.error).toMatch(/don't have permission/i);
    expect(deactivateMembershipInTransactionMock).not.toHaveBeenCalled();
  });

  it("allows Owner to deactivate anyone regardless of outranks()", async () => {
    outranksMock.mockReturnValue(false);
    const result = await deactivateMemberAction({}, validForm());
    expect(result.success).toBeDefined();
    expect(deactivateMembershipInTransactionMock).toHaveBeenCalledWith(expect.anything(), "company-1", "target-1");
  });

  it("rejects deactivating the only active Owner", async () => {
    isLastActiveOwnerMock.mockResolvedValue(true);
    const result = await deactivateMemberAction({}, validForm());
    expect(result.error).toMatch(/only active owner/i);
    expect(deactivateMembershipInTransactionMock).not.toHaveBeenCalled();
  });

  it("deactivates the member, writes an audit log entry, notifies the target, and revalidates /account on success", async () => {
    const result = await deactivateMemberAction({}, validForm());
    expect(deactivateMembershipInTransactionMock).toHaveBeenCalledWith(expect.anything(), "company-1", "target-1");
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorId: "owner-1",
        action: "membership.deactivated",
        targetType: "membership",
        targetId: "target-1",
      }),
    );
    expect(createNotificationInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "target-1",
      expect.objectContaining({ relatedEntity: { type: "membership", id: "target-1" } }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/account");
    expect(result.success).toBeDefined();
  });
});
