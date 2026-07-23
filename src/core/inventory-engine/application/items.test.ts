import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();
const setMock = vi.fn();
const updateMock = vi.fn();
const getMock = vi.fn();
const collectionGetMock = vi.fn();
const whereQueryGetMock = vi.fn();
const collectionLimitMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

// Audit logging (1G) is exercised for real in the emulator tests; here it's
// mocked out so it doesn't need its own auditLogs-collection entry in the
// fake adminDb below, which only models the inventoryItems collection.
vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: (id?: string) => ({
            id: id ?? "generated-item-id",
            set: (...args: unknown[]) => setMock(...args),
            update: (...args: unknown[]) => updateMock(...args),
            get: () => getMock(),
          }),
          get: () => collectionGetMock(),
          limit: (...args: unknown[]) => {
            collectionLimitMock(...args);
            return { get: () => collectionGetMock() };
          },
          where: () => ({
            limit: () => ({ get: () => whereQueryGetMock() }),
          }),
        }),
      }),
    }),
    // createItem/updateItem/deactivateItem all wrap their write + audit log
    // entry in one transaction (1G) -- the fake transaction just forwards
    // get/set/update to the same ref mocks used outside a transaction.
    runTransaction: async (fn: (t: unknown) => Promise<void> | void) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown) => ref.set(data),
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
  getMock.mockResolvedValue({ exists: true, data: () => ({ name: "Old Name" }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createItem", () => {
  it("requires inventory.write and writes isActive:true regardless of input", async () => {
    const { createItem } = await import("./items");

    const result = await createItem("company-1", {
      sku: "SKU-1",
      name: "Widget",
      unit: "each",
      category: "general",
      defaultPrice: 9.99,
    });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.write");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ sku: "SKU-1", name: "Widget", isActive: true }),
    );
    expect(result.isActive).toBe(true);
  });
});

describe("updateItem", () => {
  it("requires inventory.write and updates only the given fields", async () => {
    const { updateItem } = await import("./items");
    await updateItem("company-1", "item-1", { name: "Renamed" });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.write");
    expect(updateMock).toHaveBeenCalledWith({ name: "Renamed" });
  });
});

describe("deactivateItem", () => {
  it("requires inventory.write and sets isActive:false", async () => {
    const { deactivateItem } = await import("./items");
    await deactivateItem("company-1", "item-1");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.write");
    expect(updateMock).toHaveBeenCalledWith({ isActive: false });
  });
});

describe("listItems", () => {
  it("requires inventory.view and maps documents", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [
        {
          id: "item-1",
          data: () => ({ sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99, isActive: true }),
        },
      ],
    });
    const { listItems } = await import("./items");

    const result = await listItems("company-1");
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.view");
    expect(result).toEqual([
      { id: "item-1", sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99, isActive: true },
    ]);
  });

  it("bounds the read with MAX_UNBOUNDED_LIST_SIZE", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listItems } = await import("./items");

    await listItems("company-1");
    expect(collectionLimitMock).toHaveBeenCalledWith(500);
  });
});

describe("getItem", () => {
  it("requires inventory.view and returns null when not found", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { getItem } = await import("./items");

    await expect(getItem("company-1", "ghost")).resolves.toBeNull();
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.view");
  });

  it("returns the mapped item when found", async () => {
    getMock.mockResolvedValue({
      exists: true,
      id: "item-1",
      data: () => ({ sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99, isActive: true }),
    });
    const { getItem } = await import("./items");

    await expect(getItem("company-1", "item-1")).resolves.toEqual({
      id: "item-1",
      sku: "SKU-1",
      name: "Widget",
      unit: "each",
      category: "general",
      defaultPrice: 9.99,
      isActive: true,
    });
  });
});

describe("getItemByBarcode", () => {
  it("requires inventory.view and returns null when no item matches", async () => {
    whereQueryGetMock.mockResolvedValue({ empty: true, docs: [] });
    const { getItemByBarcode } = await import("./items");

    await expect(getItemByBarcode("company-1", "012345678905")).resolves.toBeNull();
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.view");
  });

  it("returns the mapped item for the matching barcode", async () => {
    whereQueryGetMock.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "item-1",
          data: () => ({
            sku: "SKU-1",
            name: "Widget",
            unit: "each",
            category: "general",
            defaultPrice: 9.99,
            isActive: true,
            barcode: "012345678905",
          }),
        },
      ],
    });
    const { getItemByBarcode } = await import("./items");

    await expect(getItemByBarcode("company-1", "012345678905")).resolves.toEqual({
      id: "item-1",
      sku: "SKU-1",
      name: "Widget",
      unit: "each",
      category: "general",
      defaultPrice: 9.99,
      isActive: true,
      barcode: "012345678905",
    });
  });
});
