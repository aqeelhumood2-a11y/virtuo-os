import { beforeEach, describe, expect, it, vi } from "vitest";

const addOrderLineMock = vi.fn();
const completeOrderMock = vi.fn();
const createNotificationMock = vi.fn();
const createOrderMock = vi.fn();
const getOrderMock = vi.fn();
const listCompanyMembersMock = vi.fn();
const listOrderLinesMock = vi.fn();
const removeOrderLineMock = vi.fn();
const updateOrderLineQuantityMock = vi.fn();
const voidOrderMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

const getOrderMetaMock = vi.fn();
const getOrderMetaByOrderIdMock = vi.fn();
const listRecentOrderMetaMock = vi.fn();
const orderMetaDocMock = vi.fn(() => ({ id: "ref" }));
const setOrderMetaInTransactionMock = vi.fn();

const transactionGetMock = vi.fn();

vi.mock("@/core", () => ({
  addOrderLine: (...args: unknown[]) => addOrderLineMock(...args),
  completeOrder: (...args: unknown[]) => completeOrderMock(...args),
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  createOrder: (...args: unknown[]) => createOrderMock(...args),
  getOrder: (...args: unknown[]) => getOrderMock(...args),
  listCompanyMembers: (...args: unknown[]) => listCompanyMembersMock(...args),
  listOrderLines: (...args: unknown[]) => listOrderLinesMock(...args),
  removeOrderLine: (...args: unknown[]) => removeOrderLineMock(...args),
  updateOrderLineQuantity: (...args: unknown[]) => updateOrderLineQuantityMock(...args),
  voidOrder: (...args: unknown[]) => voidOrderMock(...args),
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("./order-meta.repository", () => ({
  getOrderMeta: (...args: unknown[]) => getOrderMetaMock(...args),
  getOrderMetaByOrderId: (...args: unknown[]) => getOrderMetaByOrderIdMock(...args),
  listRecentOrderMeta: (...args: unknown[]) => listRecentOrderMetaMock(...args),
  orderMetaDoc: () => orderMetaDocMock(),
  setOrderMetaInTransaction: (...args: unknown[]) => setOrderMetaInTransactionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = { get: transactionGetMock, set: vi.fn() };
      return fn(fakeTransaction);
    },
  },
}));

const pendingOrder = {
  id: "order-1",
  branchId: "branch-1",
  appId: "restaurant",
  status: "pending",
  totals: { subtotal: 10, tax: 0, discount: 0, total: 10 },
  createdBy: "owner-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  transactionGetMock.mockResolvedValue({ exists: false });
  listCompanyMembersMock.mockResolvedValue([
    { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
    { uid: "manager-1", role: "Manager", branchIds: [], status: "active" },
    { uid: "employee-1", role: "Employee", branchIds: [], status: "active" },
  ]);
});

describe("createTicket", () => {
  it("short-circuits without calling Core when metadata already exists for this draftId", async () => {
    getOrderMetaMock.mockResolvedValue({
      draftId: "draft-1",
      orderId: "order-1",
      branchId: "branch-1",
      orderType: "dineIn",
      tableRef: null,
      guestCount: null,
      kitchenNote: null,
      status: "confirmed",
    });
    getOrderMock.mockResolvedValue(pendingOrder);
    const { createTicket } = await import("./order-ticket.service");

    const result = await createTicket("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      orderType: "dineIn",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });

    expect(createOrderMock).not.toHaveBeenCalled();
    expect(result.order.id).toBe("order-1");
  });

  it("creates the order and writes metadata (no repair) when the order is fresh", async () => {
    getOrderMetaMock.mockResolvedValue(null);
    createOrderMock.mockResolvedValue(pendingOrder);
    const { createTicket } = await import("./order-ticket.service");

    await createTicket("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      orderType: "dineIn",
      tableRef: "Table 4",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });

    expect(createOrderMock).toHaveBeenCalledWith(
      "company-1",
      { branchId: "branch-1", appId: "restaurant", lines: expect.any(Array) },
      { idempotencyKey: "draft-1" },
    );
    expect(setOrderMetaInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      "draft-1",
      expect.objectContaining({ orderId: "order-1", tableRef: "Table 4" }),
    );
    expect(writeAuditInTransactionMock).not.toHaveBeenCalled();
  });

  it("fires the repair audit and notifies other admins when Core returns an order past 'pending'", async () => {
    getOrderMetaMock.mockResolvedValue(null);
    createOrderMock.mockResolvedValue({ ...pendingOrder, status: "completed" });
    const { createTicket } = await import("./order-ticket.service");

    await createTicket("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      orderType: "dineIn",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });

    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "restaurant.orderMetaRepaired", targetType: "restaurantOrderMeta" }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith("manager-1", expect.anything());
    expect(createNotificationMock).not.toHaveBeenCalledWith("owner-1", expect.anything());
  });

  it("does not write metadata twice when the transaction observes a concurrent write already landed", async () => {
    getOrderMetaMock.mockResolvedValue(null);
    createOrderMock.mockResolvedValue(pendingOrder);
    transactionGetMock.mockResolvedValue({ exists: true });
    const { createTicket } = await import("./order-ticket.service");

    await createTicket("company-1", {
      draftId: "draft-1",
      branchId: "branch-1",
      orderType: "dineIn",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });

    expect(setOrderMetaInTransactionMock).not.toHaveBeenCalled();
  });
});

describe("voidTicket", () => {
  it("voids via Core then notifies other Owners/Managers, excluding the actor", async () => {
    const { voidTicket } = await import("./order-ticket.service");

    await voidTicket("company-1", "order-1", "owner-1");

    expect(voidOrderMock).toHaveBeenCalledWith("company-1", "order-1");
    expect(createNotificationMock).toHaveBeenCalledWith("manager-1", expect.anything());
    expect(createNotificationMock).not.toHaveBeenCalledWith("owner-1", expect.anything());
    expect(createNotificationMock).not.toHaveBeenCalledWith("employee-1", expect.anything());
  });
});

describe("listOrderHistory / resumePendingTickets", () => {
  it("pairs each meta with its Core order, dropping any meta whose order is missing", async () => {
    listRecentOrderMetaMock.mockResolvedValue([
      { draftId: "d1", orderId: "order-1" },
      { draftId: "d2", orderId: "order-missing" },
    ]);
    getOrderMock.mockImplementation(async (_companyId: string, orderId: string) =>
      orderId === "order-1" ? pendingOrder : null,
    );
    const { listOrderHistory } = await import("./order-ticket.service");

    const result = await listOrderHistory("company-1");
    expect(result).toHaveLength(1);
    expect(result[0].order.id).toBe("order-1");
  });

  it("resumePendingTickets filters to Core orders still pending", async () => {
    listRecentOrderMetaMock.mockResolvedValue([
      { draftId: "d1", orderId: "order-1" },
      { draftId: "d2", orderId: "order-2" },
    ]);
    getOrderMock.mockImplementation(async (_companyId: string, orderId: string) =>
      orderId === "order-1" ? pendingOrder : { ...pendingOrder, id: "order-2", status: "completed" },
    );
    const { resumePendingTickets } = await import("./order-ticket.service");

    const result = await resumePendingTickets("company-1");
    expect(result).toHaveLength(1);
    expect(result[0].order.id).toBe("order-1");
  });
});
