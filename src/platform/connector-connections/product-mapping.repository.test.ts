import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const docSetMock = vi.fn();
const collectionGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: docGetMock, set: (...args: unknown[]) => docSetMock(...args) }),
              get: collectionGetMock,
            }),
          }),
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProductMapping", () => {
  it("returns null when no mapping exists", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getProductMapping } = await import("./product-mapping.repository");

    await expect(getProductMapping("company-1", "shopify", "ext-1")).resolves.toBeNull();
  });

  it("maps a stored doc back to a ProductMapping", async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      id: "ext-1",
      data: () => ({ itemId: "item-1", externalQuantity: 5, lastSyncedAt: "2026-01-01T00:00:00.000Z" }),
    });
    const { getProductMapping } = await import("./product-mapping.repository");

    await expect(getProductMapping("company-1", "shopify", "ext-1")).resolves.toEqual({
      externalId: "ext-1",
      itemId: "item-1",
      externalQuantity: 5,
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("listProductMappings", () => {
  it("maps every doc in the collection", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [{ id: "ext-1", data: () => ({ itemId: "item-1", lastSyncedAt: "2026-01-01T00:00:00.000Z" }) }],
    });
    const { listProductMappings } = await import("./product-mapping.repository");

    await expect(listProductMappings("company-1", "shopify")).resolves.toEqual([
      { externalId: "ext-1", itemId: "item-1", externalQuantity: undefined, lastSyncedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("setProductMapping", () => {
  it("writes a merge:true set with the mapping fields", async () => {
    const { setProductMapping } = await import("./product-mapping.repository");

    await setProductMapping("company-1", "shopify", "ext-1", "item-1", 5, "2026-01-01T00:00:00.000Z");

    expect(docSetMock).toHaveBeenCalledWith(
      { itemId: "item-1", externalQuantity: 5, lastSyncedAt: "2026-01-01T00:00:00.000Z" },
      { merge: true },
    );
  });

  it("stores null when externalQuantity is undefined", async () => {
    const { setProductMapping } = await import("./product-mapping.repository");

    await setProductMapping("company-1", "shopify", "ext-1", "item-1", undefined, "2026-01-01T00:00:00.000Z");

    expect(docSetMock).toHaveBeenCalledWith(
      { itemId: "item-1", externalQuantity: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" },
      { merge: true },
    );
  });
});
