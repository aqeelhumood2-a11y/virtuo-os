import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const collectionGetMock = vi.fn();
const docSetMock = vi.fn();
const docGetMock = vi.fn();
const orderByMock = vi.fn();
const limitMock = vi.fn();
const startAfterMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

// A chainable fake Firestore query -- orderBy()/limit()/startAfter() each
// return the same ref so `.orderBy(...).limit(...)` (and, with a cursor,
// `.startAfter(...)`) compose the way the real Query builder does, while
// still letting each individual call be asserted on via its own spy.
function makeQueryRef() {
  const ref = {
    doc: (id?: string) => ({
      id: id ?? "generated-log-id",
      set: (...args: unknown[]) => docSetMock(...args),
      get: () => docGetMock(),
    }),
    get: () => collectionGetMock(),
    orderBy: (...args: unknown[]) => {
      orderByMock(...args);
      return ref;
    },
    limit: (...args: unknown[]) => {
      limitMock(...args);
      return ref;
    },
    startAfter: (...args: unknown[]) => {
      startAfterMock(...args);
      return ref;
    },
  };
  return ref;
}

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => makeQueryRef(),
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
  docGetMock.mockResolvedValue({ exists: false });
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

describe("listAuditLogsPage", () => {
  it("requires audit.view and orders newest-first, limited to the requested page size", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listAuditLogsPage } = await import("./audit-logger");

    await listAuditLogsPage("company-1", { limit: 10 });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "audit.view");
    expect(orderByMock).toHaveBeenCalledWith("createdAt", "desc");
    expect(limitMock).toHaveBeenCalledWith(10);
  });

  it("defaults to a page size of 50 when no limit is given", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listAuditLogsPage } = await import("./audit-logger");

    await listAuditLogsPage("company-1");

    expect(limitMock).toHaveBeenCalledWith(50);
  });

  it("returns nextCursor as the last entry's id when a full page comes back", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [
        { id: "log-1", data: () => ({ actorId: "a", action: "company.updated", targetType: "company", targetId: "c1" }) },
        { id: "log-2", data: () => ({ actorId: "a", action: "company.updated", targetType: "company", targetId: "c1" }) },
      ],
    });
    const { listAuditLogsPage } = await import("./audit-logger");

    const page = await listAuditLogsPage("company-1", { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("log-2");
  });

  it("returns nextCursor: null when fewer docs than the limit come back (last page)", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [{ id: "log-1", data: () => ({ actorId: "a", action: "company.updated", targetType: "company", targetId: "c1" }) }],
    });
    const { listAuditLogsPage } = await import("./audit-logger");

    const page = await listAuditLogsPage("company-1", { limit: 10 });
    expect(page.nextCursor).toBeNull();
  });

  it("resolves a given cursor to a document snapshot and passes it to startAfter", async () => {
    docGetMock.mockResolvedValue({ exists: true, id: "log-1" });
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listAuditLogsPage } = await import("./audit-logger");

    await listAuditLogsPage("company-1", { cursor: "log-1" });

    expect(startAfterMock).toHaveBeenCalledWith({ exists: true, id: "log-1" });
  });

  it("ignores a cursor that no longer exists rather than throwing", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listAuditLogsPage } = await import("./audit-logger");

    await expect(listAuditLogsPage("company-1", { cursor: "ghost" })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(startAfterMock).not.toHaveBeenCalled();
  });

  it("propagates the capability guard's rejection without reading Firestore", async () => {
    requireCapabilityMock.mockRejectedValue(new Error("Forbidden"));
    const { listAuditLogsPage } = await import("./audit-logger");

    await expect(listAuditLogsPage("company-1")).rejects.toThrow("Forbidden");
    expect(collectionGetMock).not.toHaveBeenCalled();
  });
});
