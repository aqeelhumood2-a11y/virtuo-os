import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const setMock = vi.fn();
const updateMock = vi.fn();
const getMock = vi.fn();
const collectionGetMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
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
