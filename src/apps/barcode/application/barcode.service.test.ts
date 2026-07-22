import { beforeEach, describe, expect, it, vi } from "vitest";

const getItemByBarcodeMock = vi.fn();
const createOrderMock = vi.fn();

vi.mock("@/core", () => ({
  getItemByBarcode: (...args: unknown[]) => getItemByBarcodeMock(...args),
  createOrder: (...args: unknown[]) => createOrderMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lookupByBarcode", () => {
  it("delegates directly to Core's getItemByBarcode", async () => {
    getItemByBarcodeMock.mockResolvedValue({ id: "item-1", sku: "SKU-1", name: "Widget", unit: "each", category: "general", defaultPrice: 9.99, isActive: true, barcode: "012345678905" });
    const { lookupByBarcode } = await import("./barcode.service");

    const result = await lookupByBarcode("company-1", "012345678905");

    expect(getItemByBarcodeMock).toHaveBeenCalledWith("company-1", "012345678905");
    expect(result?.id).toBe("item-1");
  });

  it("returns null when nothing matches", async () => {
    getItemByBarcodeMock.mockResolvedValue(null);
    const { lookupByBarcode } = await import("./barcode.service");

    await expect(lookupByBarcode("company-1", "ghost")).resolves.toBeNull();
  });
});

describe("quickSale", () => {
  it("delegates to Core's createOrder with appId barcode and the draftId as idempotencyKey", async () => {
    createOrderMock.mockResolvedValue({ id: "order-1" });
    const { quickSale } = await import("./barcode.service");

    await quickSale("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 9.99 }],
    });

    expect(createOrderMock).toHaveBeenCalledWith(
      "company-1",
      { branchId: "branch-1", appId: "barcode", lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 9.99 }] },
      { idempotencyKey: "draft-1" },
    );
  });
});
