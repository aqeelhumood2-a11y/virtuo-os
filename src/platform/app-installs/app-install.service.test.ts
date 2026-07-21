import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformCapabilityMock = vi.fn();
const requireSuperAdminMock = vi.fn();
const getAppManifestMock = vi.fn();
const isAppEntitledMock = vi.fn();
const listCompanyMembersMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();
const createNotificationInTransactionMock = vi.fn();

const docGetMock = vi.fn();
const docSetMock = vi.fn();

vi.mock("../shared/require-platform-capability", () => ({
  requirePlatformCapability: (...args: unknown[]) => requirePlatformCapabilityMock(...args),
}));

vi.mock("@/core/roles-permissions", () => ({
  requireSuperAdmin: () => requireSuperAdminMock(),
}));

vi.mock("@/app-registry", () => ({
  getAppManifest: (...args: unknown[]) => getAppManifestMock(...args),
}));

vi.mock("../licenses/license.repository", () => ({
  isAppEntitled: (...args: unknown[]) => isAppEntitledMock(...args),
}));

vi.mock("@/core/companies/membership", () => ({
  listCompanyMembers: (...args: unknown[]) => listCompanyMembersMock(...args),
}));

vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("@/core/notifications", () => ({
  createNotificationInTransaction: (...args: unknown[]) => createNotificationInTransactionMock(...args),
}));

// Same fake-transaction shape used throughout Core's own service tests
// (e.g. inventory-engine's stock.test.ts): transaction.get/set just forward
// to the same ref mocks used outside a transaction.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: () => docGetMock(), set: (...args: unknown[]) => docSetMock(...args) }),
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
  requirePlatformCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  getAppManifestMock.mockReturnValue({ id: "restaurant", displayName: "Restaurant" });
  isAppEntitledMock.mockResolvedValue(true);
  listCompanyMembersMock.mockResolvedValue([
    { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
    { uid: "manager-1", role: "Manager", branchIds: [], status: "active" },
    { uid: "employee-1", role: "Employee", branchIds: [], status: "active" },
  ]);
  docGetMock.mockResolvedValue({ exists: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("installApp", () => {
  it("requires apps.install, checks the catalog and entitlement, then writes+audits+notifies", async () => {
    const { installApp } = await import("./app-install.service");
    await installApp("company-1", "restaurant");

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "apps.install");
    expect(getAppManifestMock).toHaveBeenCalledWith("restaurant");
    expect(isAppEntitledMock).toHaveBeenCalledWith("company-1", "restaurant");
    expect(docSetMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }), { merge: true });
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorId: "owner-1",
        action: "app.installed",
        targetType: "app",
        targetId: "restaurant",
        before: { enabled: false },
        after: { enabled: true },
      }),
    );
  });

  it("notifies the other Owner/Manager, never the acting admin, never an Employee", async () => {
    const { installApp } = await import("./app-install.service");
    await installApp("company-1", "restaurant");

    expect(createNotificationInTransactionMock).toHaveBeenCalledTimes(1);
    expect(createNotificationInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "manager-1",
      expect.objectContaining({ relatedEntity: { type: "app", id: "restaurant" } }),
    );
  });

  it("throws AppNotRegisteredError when the app isn't in the catalog, writing nothing", async () => {
    getAppManifestMock.mockReturnValue(null);
    const { installApp, AppNotRegisteredError } = await import("./app-install.service");

    await expect(installApp("company-1", "ghost-app")).rejects.toThrow(AppNotRegisteredError);
    expect(docSetMock).not.toHaveBeenCalled();
    expect(writeAuditInTransactionMock).not.toHaveBeenCalled();
  });

  it("throws AppNotEntitledError when the plan doesn't include the app, writing nothing", async () => {
    isAppEntitledMock.mockResolvedValue(false);
    const { installApp, AppNotEntitledError } = await import("./app-install.service");

    await expect(installApp("company-1", "restaurant")).rejects.toThrow(AppNotEntitledError);
    expect(docSetMock).not.toHaveBeenCalled();
  });

  it("preserves the original installedAt on a re-install", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ enabled: false, installedAt: "original-timestamp" }) });
    const { installApp } = await import("./app-install.service");

    await installApp("company-1", "restaurant");

    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ installedAt: "original-timestamp" }),
      { merge: true },
    );
  });
});

describe("uninstallApp", () => {
  it("requires apps.install and writes enabled:false, with no catalog/entitlement check", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ enabled: true, installedAt: "2026-01-01" }) });
    const { uninstallApp } = await import("./app-install.service");

    await uninstallApp("company-1", "restaurant");

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "apps.install");
    expect(getAppManifestMock).not.toHaveBeenCalled();
    expect(isAppEntitledMock).not.toHaveBeenCalled();
    expect(docSetMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), { merge: true });
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "app.uninstalled", before: { enabled: true }, after: { enabled: false } }),
    );
  });
});

describe("forceToggleApp", () => {
  it("uses requireSuperAdmin instead of requirePlatformCapability, bypassing entitlement entirely", async () => {
    requireSuperAdminMock.mockResolvedValue({ uid: "admin-1", email: null, superAdmin: true });
    isAppEntitledMock.mockResolvedValue(false);

    const { forceToggleApp } = await import("./app-install.service");
    await forceToggleApp("company-1", "restaurant", true);

    expect(requireSuperAdminMock).toHaveBeenCalledTimes(1);
    expect(requirePlatformCapabilityMock).not.toHaveBeenCalled();
    expect(isAppEntitledMock).not.toHaveBeenCalled();
    expect(docSetMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }), { merge: true });
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: "admin-1", action: "app.forceToggled" }),
    );
  });
});
