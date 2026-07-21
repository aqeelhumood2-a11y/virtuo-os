import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const requireCompanyMembershipMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();
const getMock = vi.fn();
const setMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

vi.mock("./membership", () => ({
  requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
}));

vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: () => getMock(), set: (...args: unknown[]) => setMock(...args) }),
        }),
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown, opts?: unknown) => ref.set(data, opts),
      };
      return fn(fakeTransaction);
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  requireCompanyMembershipMock.mockResolvedValue({
    session: { uid: "employee-1", email: null, superAdmin: false },
    membership: { uid: "employee-1", role: "Employee", branchIds: [], status: "active" },
  });
  requireCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  getMock.mockResolvedValue({ exists: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCompanyBranding", () => {
  it("requires only active membership, not a specific capability", async () => {
    const { getCompanyBranding } = await import("./company-settings");
    await getCompanyBranding("company-1");

    expect(requireCompanyMembershipMock).toHaveBeenCalledWith("company-1");
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it("returns an empty object when no branding doc exists yet", async () => {
    const { getCompanyBranding } = await import("./company-settings");
    await expect(getCompanyBranding("company-1")).resolves.toEqual({});
  });

  it("returns the stored logoUrl/primaryColor", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ logoUrl: "https://x.test/logo.png", primaryColor: "#336699" }) });
    const { getCompanyBranding } = await import("./company-settings");

    await expect(getCompanyBranding("company-1")).resolves.toEqual({
      logoUrl: "https://x.test/logo.png",
      primaryColor: "#336699",
    });
  });
});

describe("updateCompanyBranding", () => {
  it("requires company.update and writes the branding fields", async () => {
    const { updateCompanyBranding } = await import("./company-settings");
    await updateCompanyBranding("company-1", { logoUrl: "https://x.test/logo.png", primaryColor: "#336699" });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "company.update");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: "https://x.test/logo.png", primaryColor: "#336699" }),
      { merge: true },
    );
  });

  it("writes a company.brandingUpdated audit entry with before/after values", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ logoUrl: "https://old.test/logo.png", primaryColor: "#000000" }) });
    const { updateCompanyBranding } = await import("./company-settings");

    await updateCompanyBranding("company-1", { logoUrl: "https://new.test/logo.png", primaryColor: "#ffffff" });

    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorId: "owner-1",
        action: "company.brandingUpdated",
        targetType: "companySettings",
        targetId: "branding",
        before: { logoUrl: "https://old.test/logo.png", primaryColor: "#000000" },
        after: { logoUrl: "https://new.test/logo.png", primaryColor: "#ffffff" },
      }),
    );
  });

  it("stores null for an omitted field rather than leaving it stale", async () => {
    const { updateCompanyBranding } = await import("./company-settings");
    await updateCompanyBranding("company-1", {});

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: null, primaryColor: null }),
      { merge: true },
    );
  });
});
