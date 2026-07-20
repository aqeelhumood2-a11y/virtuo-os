import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const collectionGetMock = vi.fn();
const docSetMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ set: (...args: unknown[]) => docSetMock(...args) }),
          get: () => collectionGetMock(),
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  vi.resetModules();
  requireCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeAuditInTransaction", () => {
  it("writes the entry via transaction.set, stripping companyId out of the written document", async () => {
    const { writeAuditInTransaction } = await import("./audit-logger");
    const transactionSetMock = vi.fn();
    const fakeTransaction = { set: (...args: unknown[]) => transactionSetMock(...args) };

    writeAuditInTransaction(fakeTransaction as never, {
      companyId: "company-1",
      actorId: "owner-1",
      action: "inventory.itemCreated",
      targetType: "inventoryItem",
      targetId: "item-1",
      after: { name: "Widget" },
    });

    expect(transactionSetMock).toHaveBeenCalledTimes(1);
    const [, entry] = transactionSetMock.mock.calls[0];
    expect(entry).toMatchObject({
      actorId: "owner-1",
      action: "inventory.itemCreated",
      targetType: "inventoryItem",
      targetId: "item-1",
      after: { name: "Widget" },
    });
    expect(entry).not.toHaveProperty("companyId");
    expect(entry.createdAt).toBeDefined();
  });

  it("never calls a capability check -- it's an internal recording primitive, not an entry point", async () => {
    const { writeAuditInTransaction } = await import("./audit-logger");
    const fakeTransaction = { set: vi.fn() };

    writeAuditInTransaction(fakeTransaction as never, {
      companyId: "company-1",
      actorId: "owner-1",
      action: "company.updated",
      targetType: "company",
      targetId: "company-1",
    });

    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });
});

describe("listAuditLogs", () => {
  it("requires audit.view and maps documents to AuditLogEntry", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [
        {
          id: "log-1",
          data: () => ({
            actorId: "owner-1",
            action: "company.updated",
            targetType: "company",
            targetId: "company-1",
            before: { name: "Old" },
            after: { name: "New" },
          }),
        },
      ],
    });
    const { listAuditLogs } = await import("./audit-logger");

    const result = await listAuditLogs("company-1");
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "audit.view");
    expect(result).toEqual([
      {
        id: "log-1",
        actorId: "owner-1",
        action: "company.updated",
        targetType: "company",
        targetId: "company-1",
        branchId: undefined,
        before: { name: "Old" },
        after: { name: "New" },
      },
    ]);
  });

  it("returns an empty list when there are no entries", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listAuditLogs } = await import("./audit-logger");

    await expect(listAuditLogs("company-1")).resolves.toEqual([]);
  });

  it("propagates the capability guard's rejection without reading Firestore", async () => {
    requireCapabilityMock.mockRejectedValue(new Error("Forbidden"));
    const { listAuditLogs } = await import("./audit-logger");

    await expect(listAuditLogs("company-1")).rejects.toThrow("Forbidden");
    expect(collectionGetMock).not.toHaveBeenCalled();
  });
});
