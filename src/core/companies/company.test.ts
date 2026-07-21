import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();
const getMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: () => getMock(),
        update: (...args: unknown[]) => updateMock(...args),
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<void> | void) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        update: (ref: { update: (data: unknown) => void }, data: unknown) => ref.update(data),
      };
      return fn(fakeTransaction);
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  requireCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  getMock.mockResolvedValue({ exists: true, data: () => ({ name: "Acme", status: "active" }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateCompanyName", () => {
  it("requires company.update, updates the name, and writes a matching audit log entry", async () => {
    const { updateCompanyName } = await import("./company");
    await updateCompanyName("company-1", "New Name");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "company.update");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ name: "New Name" }));
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorId: "owner-1",
        action: "company.updated",
        targetType: "company",
        targetId: "company-1",
        before: { name: "Acme" },
        after: { name: "New Name" },
      }),
    );
  });

  it("throws when the company doesn't exist, writing nothing", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { updateCompanyName } = await import("./company");

    await expect(updateCompanyName("company-1", "New Name")).rejects.toThrow(/not found/i);
    expect(updateMock).not.toHaveBeenCalled();
    expect(writeAuditInTransactionMock).not.toHaveBeenCalled();
  });
});

describe("setCompanyStatus", () => {
  it("logs company.suspended when transitioning to suspended", async () => {
    const { setCompanyStatus } = await import("./company");
    await setCompanyStatus("company-1", "suspended");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "company.suspend");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "suspended" }));
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.suspended",
        before: { status: "active" },
        after: { status: "suspended" },
      }),
    );
  });

  it("logs company.reactivated when transitioning to active", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ name: "Acme", status: "suspended" }) });
    const { setCompanyStatus } = await import("./company");
    await setCompanyStatus("company-1", "active");

    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.reactivated",
        before: { status: "suspended" },
        after: { status: "active" },
      }),
    );
  });

  it("throws when the company doesn't exist, writing nothing", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { setCompanyStatus } = await import("./company");

    await expect(setCompanyStatus("company-1", "suspended")).rejects.toThrow(/not found/i);
    expect(updateMock).not.toHaveBeenCalled();
    expect(writeAuditInTransactionMock).not.toHaveBeenCalled();
  });
});
