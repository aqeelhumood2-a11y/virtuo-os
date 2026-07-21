import { beforeEach, describe, expect, it, vi } from "vitest";

const addOrderLineMock = vi.fn();
const completeOrderMock = vi.fn();
const createNotificationMock = vi.fn();
const createOrderMock = vi.fn();
const getOrderMock = vi.fn();
const listCompanyMembersMock = vi.fn();
const listOrderLinesMock = vi.fn();
const listOrdersForBranchMock = vi.fn();
const removeOrderLineMock = vi.fn();
const updateOrderLineQuantityMock = vi.fn();
const voidOrderMock = vi.fn();

vi.mock("@/core", () => ({
  addOrderLine: (...args: unknown[]) => addOrderLineMock(...args),
  completeOrder: (...args: unknown[]) => completeOrderMock(...args),
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  createOrder: (...args: unknown[]) => createOrderMock(...args),
  getOrder: (...args: unknown[]) => getOrderMock(...args),
  listCompanyMembers: (...args: unknown[]) => listCompanyMembersMock(...args),
  listOrderLines: (...args: unknown[]) => listOrderLinesMock(...args),
  listOrdersForBranch: (...args: unknown[]) => listOrdersForBranchMock(...args),
  removeOrderLine: (...args: unknown[]) => removeOrderLineMock(...args),
  updateOrderLineQuantity: (...args: unknown[]) => updateOrderLineQuantityMock(...args),
  voidOrder: (...args: unknown[]) => voidOrderMock(...args),
}));

const pendingOrder = {
  id: "order-1",
  branchId: "branch-1",
  appId: "retail",
  status: "pending",
  totals: { subtotal: 10, tax: 0, discount: 0, total: 10 },
  createdBy: "owner-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  listCompanyMembersMock.mockResolvedValue([
    { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
    { uid: "manager-1", role: "Manager", branchIds: [], status: "active" },
    { uid: "employee-1", role: "Employee", branchIds: [], status: "active" },
  ]);
});

describe("createSale", () => {
  it("delegates straight to Core's createOrder with appId 'retail' and the draftId as idempotencyKey", async () => {
    createOrderMock.mockResolvedValue(pendingOrder);
    const { createSale } = await import("./sale.service");

    const result = await createSale("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 5 }],
    });

    expect(createOrderMock).toHaveBeenCalledWith(
      "company-1",
      { branchId: "branch-1", appId: "retail", lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 5 }] },
      { idempotencyKey: "draft-1" },
    );
    expect(result).toBe(pendingOrder);
  });
});

describe("addLine / updateLineQuantity / removeLine / completeSale", () => {
  it("addLine delegates to Core's addOrderLine", async () => {
    const { addLine } = await import("./sale.service");
    await addLine("company-1", "order-1", { itemId: "item-2", itemNameSnapshot: "Gadget", quantity: 1, unitPrice: 10 });

    expect(addOrderLineMock).toHaveBeenCalledWith("company-1", "order-1", {
      itemId: "item-2",
      itemNameSnapshot: "Gadget",
      quantity: 1,
      unitPrice: 10,
    });
  });

  it("updateLineQuantity delegates to Core's updateOrderLineQuantity", async () => {
    const { updateLineQuantity } = await import("./sale.service");
    await updateLineQuantity("company-1", "order-1", "line-1", 3);

    expect(updateOrderLineQuantityMock).toHaveBeenCalledWith("company-1", "order-1", "line-1", 3);
  });

  it("removeLine delegates to Core's removeOrderLine", async () => {
    const { removeLine } = await import("./sale.service");
    await removeLine("company-1", "order-1", "line-1");

    expect(removeOrderLineMock).toHaveBeenCalledWith("company-1", "order-1", "line-1");
  });

  it("completeSale delegates to Core's completeOrder", async () => {
    const { completeSale } = await import("./sale.service");
    await completeSale("company-1", "order-1");

    expect(completeOrderMock).toHaveBeenCalledWith("company-1", "order-1");
  });
});

describe("voidSale", () => {
  it("voids via Core then notifies other Owners/Managers, excluding the actor", async () => {
    const { voidSale } = await import("./sale.service");

    await voidSale("company-1", "order-1", "owner-1");

    expect(voidOrderMock).toHaveBeenCalledWith("company-1", "order-1");
    expect(createNotificationMock).toHaveBeenCalledWith("manager-1", expect.anything());
    expect(createNotificationMock).not.toHaveBeenCalledWith("owner-1", expect.anything());
    expect(createNotificationMock).not.toHaveBeenCalledWith("employee-1", expect.anything());
  });
});

describe("getSaleDetail", () => {
  it("returns null when the order doesn't exist", async () => {
    getOrderMock.mockResolvedValue(null);
    const { getSaleDetail } = await import("./sale.service");

    await expect(getSaleDetail("company-1", "ghost")).resolves.toBeNull();
    expect(listOrderLinesMock).not.toHaveBeenCalled();
  });

  it("pairs the order with its lines", async () => {
    getOrderMock.mockResolvedValue(pendingOrder);
    listOrderLinesMock.mockResolvedValue([{ id: "line-1" }]);
    const { getSaleDetail } = await import("./sale.service");

    const result = await getSaleDetail("company-1", "order-1");
    expect(result).toEqual({ order: pendingOrder, lines: [{ id: "line-1" }] });
  });
});

describe("listSaleHistory / listPendingSales", () => {
  it("listSaleHistory delegates straight to Core's listOrdersForBranch", async () => {
    listOrdersForBranchMock.mockResolvedValue([pendingOrder]);
    const { listSaleHistory } = await import("./sale.service");

    const result = await listSaleHistory("company-1", "branch-1");
    expect(listOrdersForBranchMock).toHaveBeenCalledWith("company-1", "branch-1");
    expect(result).toEqual([pendingOrder]);
  });

  it("listPendingSales filters to status 'pending'", async () => {
    listOrdersForBranchMock.mockResolvedValue([pendingOrder, { ...pendingOrder, id: "order-2", status: "completed" }]);
    const { listPendingSales } = await import("./sale.service");

    const result = await listPendingSales("company-1", "branch-1");
    expect(result).toEqual([pendingOrder]);
  });
});
