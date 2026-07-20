import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const hasBranchAccessMock = vi.fn();
const planStockChangeMock = vi.fn();
const commitStockChangePlanMock = vi.fn();

const orderGetMock = vi.fn();
const orderSetMock = vi.fn();
const orderUpdateMock = vi.fn();
const ordersWhereGetMock = vi.fn();
const lineSetMock = vi.fn();
const linesGetMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

vi.mock("@/core/companies/membership", () => ({
  hasBranchAccess: (...args: unknown[]) => hasBranchAccessMock(...args),
}));

vi.mock("@/core/inventory-engine", () => ({
  planStockChange: (...args: unknown[]) => planStockChangeMock(...args),
  commitStockChangePlan: (...args: unknown[]) => commitStockChangePlanMock(...args),
}));

// Same fake-transaction shape as inventory-engine's stock.test.ts: each
// mocked ref carries its own get/set/update so transaction.get/set/update
// can just forward to it, with no need to track ref identity.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => {
          if (name !== "orders") throw new Error(`unexpected collection: ${name}`);
          return {
            doc: () => ({
              get: orderGetMock,
              set: (...args: unknown[]) => orderSetMock(...args),
              update: (...args: unknown[]) => orderUpdateMock(...args),
              collection: (subName: string) => {
                if (subName !== "lines") throw new Error(`unexpected subcollection: ${subName}`);
                return {
                  doc: () => ({ set: (...args: unknown[]) => lineSetMock(...args) }),
                  get: linesGetMock,
                };
              },
            }),
            where: () => ({ get: ordersWhereGetMock }),
          };
        },
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown, opts?: unknown) => ref.set(data, opts),
        update: (ref: { update: (data: unknown) => void }, data: unknown) => ref.update(data),
      };
      return fn(fakeTransaction);
    },
  },
}));

function fakeOrderSnapshot(exists: boolean, data?: Record<string, unknown>) {
  return { exists, id: "order-1", data: () => data };
}

function fakeQuerySnapshot(docs: Record<string, unknown>[]) {
  return { docs: docs.map((data, index) => ({ id: `doc-${index}`, data: () => data })) };
}

const pendingOrder = {
  branchId: "branch-1",
  appId: "retail",
  status: "pending",
  totals: { subtotal: 0, tax: 0, discount: 0, total: 0 },
  createdBy: "owner-1",
};

const completedOrder = { ...pendingOrder, status: "completed" };
const voidedOrder = { ...pendingOrder, status: "voided" };

beforeEach(() => {
  vi.resetModules();
  requireCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  hasBranchAccessMock.mockReturnValue(true);
  orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, pendingOrder));
  linesGetMock.mockResolvedValue(fakeQuerySnapshot([]));
  planStockChangeMock.mockResolvedValue({
    stockRef: {},
    movementRef: {},
    branchId: "branch-1",
    itemId: "item-1",
    quantityOnHand: 0,
    reorderPoint: 0,
    type: "sale",
    quantityDelta: -1,
    itemNameSnapshot: "Widget",
    reason: "order-completed",
    performedBy: "owner-1",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createOrder", () => {
  it("requires orders.create scoped to the order's branch", async () => {
    const { createOrder } = await import("./orders");
    await createOrder("company-1", {
      branchId: "branch-1",
      appId: "retail",
      lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 5 }],
    });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "orders.create");
    expect(hasBranchAccessMock).toHaveBeenCalledWith(
      { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
      "branch-1",
    );
  });

  it("computes totals from the lines and writes the order as pending", async () => {
    const { createOrder } = await import("./orders");
    const result = await createOrder("company-1", {
      branchId: "branch-1",
      appId: "retail",
      lines: [
        { itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 5 },
        { itemId: "item-2", itemNameSnapshot: "Gadget", quantity: 1, unitPrice: 10 },
      ],
      tax: 2,
    });

    expect(orderSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        totals: { subtotal: 20, tax: 2, discount: 0, total: 22 },
      }),
      undefined,
    );
    expect(lineSetMock).toHaveBeenCalledTimes(2);
    expect(result.totals).toEqual({ subtotal: 20, tax: 2, discount: 0, total: 22 });
  });

  it("rejects an order with no lines", async () => {
    const { createOrder } = await import("./orders");
    await expect(createOrder("company-1", { branchId: "branch-1", appId: "retail", lines: [] })).rejects.toThrow(
      /at least one line/i,
    );
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive line quantity", async () => {
    const { createOrder } = await import("./orders");
    await expect(
      createOrder("company-1", {
        branchId: "branch-1",
        appId: "retail",
        lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 0, unitPrice: 5 }],
      }),
    ).rejects.toThrow(/positive/i);
  });
});

describe("addOrderLine", () => {
  it("rejects adding a line to a non-pending order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, completedOrder));
    const { addOrderLine } = await import("./orders");
    const { OrderNotEditableError } = await import("../domain/errors");

    await expect(
      addOrderLine("company-1", "order-1", { itemId: "item-1", itemNameSnapshot: "Widget", quantity: 1, unitPrice: 5 }),
    ).rejects.toThrow(OrderNotEditableError);
    expect(lineSetMock).not.toHaveBeenCalled();
  });

  it("recomputes totals including the existing lines", async () => {
    linesGetMock.mockResolvedValue(fakeQuerySnapshot([{ lineTotal: 20 }]));
    const { addOrderLine } = await import("./orders");
    await addOrderLine("company-1", "order-1", {
      itemId: "item-2",
      itemNameSnapshot: "Gadget",
      quantity: 1,
      unitPrice: 10,
    });

    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ totals: { subtotal: 30, tax: 0, discount: 0, total: 30 } }),
    );
  });
});

describe("completeOrder", () => {
  it("requires orders.complete and rejects a non-pending order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, completedOrder));
    const { completeOrder } = await import("./orders");
    const { InvalidOrderTransitionError } = await import("../domain/errors");

    await expect(completeOrder("company-1", "order-1")).rejects.toThrow(InvalidOrderTransitionError);
    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "orders.complete");
    expect(commitStockChangePlanMock).not.toHaveBeenCalled();
  });

  it("plans and commits a stock deduction per line, then marks the order completed", async () => {
    linesGetMock.mockResolvedValue(fakeQuerySnapshot([{ itemId: "item-1", quantity: 2 }]));
    const { completeOrder } = await import("./orders");

    await completeOrder("company-1", "order-1");

    expect(planStockChangeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: "item-1", type: "sale", reason: "order-completed" }),
    );
    const [, params] = planStockChangeMock.mock.calls[0];
    expect(params.computeDelta(10)).toBe(-2);
    expect(commitStockChangePlanMock).toHaveBeenCalledTimes(1);
    expect(orderUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("propagates insufficient-stock rejection without completing the order", async () => {
    linesGetMock.mockResolvedValue(fakeQuerySnapshot([{ itemId: "item-1", quantity: 2 }]));
    planStockChangeMock.mockRejectedValue(new Error("insufficient stock"));
    const { completeOrder } = await import("./orders");

    await expect(completeOrder("company-1", "order-1")).rejects.toThrow("insufficient stock");
    expect(commitStockChangePlanMock).not.toHaveBeenCalled();
    expect(orderUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects completing an already-voided order (idempotency)", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, voidedOrder));
    const { completeOrder } = await import("./orders");
    const { InvalidOrderTransitionError } = await import("../domain/errors");

    await expect(completeOrder("company-1", "order-1")).rejects.toThrow(InvalidOrderTransitionError);
  });
});

describe("voidOrder", () => {
  it("requires orders.void", async () => {
    const { voidOrder } = await import("./orders");
    await voidOrder("company-1", "order-1");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "orders.void");
  });

  it("voids a pending order with no stock effect", async () => {
    const { voidOrder } = await import("./orders");
    await voidOrder("company-1", "order-1");

    expect(planStockChangeMock).not.toHaveBeenCalled();
    expect(orderUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "voided" }));
  });

  it("reverses every line's deduction when voiding a completed order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, completedOrder));
    linesGetMock.mockResolvedValue(fakeQuerySnapshot([{ itemId: "item-1", quantity: 2 }]));
    const { voidOrder } = await import("./orders");

    await voidOrder("company-1", "order-1");

    const [, params] = planStockChangeMock.mock.calls[0];
    expect(params.reason).toBe("order-voided");
    expect(params.computeDelta(0)).toBe(2);
    expect(commitStockChangePlanMock).toHaveBeenCalledTimes(1);
    expect(orderUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "voided" }));
  });

  it("rejects voiding an already-voided order (idempotency)", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, voidedOrder));
    const { voidOrder } = await import("./orders");
    const { InvalidOrderTransitionError } = await import("../domain/errors");

    await expect(voidOrder("company-1", "order-1")).rejects.toThrow(InvalidOrderTransitionError);
  });
});

describe("getOrder / listOrdersForBranch / listOrderLines", () => {
  it("getOrder returns null when the order does not exist", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(false));
    const { getOrder } = await import("./orders");
    await expect(getOrder("company-1", "ghost")).resolves.toBeNull();
  });

  it("getOrder enforces branch access for an existing order", async () => {
    hasBranchAccessMock.mockReturnValue(false);
    const { getOrder } = await import("./orders");
    const { BranchAccessDeniedError } = await import("@/core/companies/errors");
    await expect(getOrder("company-1", "order-1")).rejects.toThrow(BranchAccessDeniedError);
  });

  it("listOrdersForBranch requires orders.view and branch access", async () => {
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([pendingOrder]));
    const { listOrdersForBranch } = await import("./orders");
    const result = await listOrdersForBranch("company-1", "branch-1");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "orders.view");
    expect(result).toHaveLength(1);
  });

  it("listOrderLines throws OrderNotFoundError for a missing order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(false));
    const { listOrderLines } = await import("./orders");
    const { OrderNotFoundError } = await import("../domain/errors");
    await expect(listOrderLines("company-1", "ghost")).rejects.toThrow(OrderNotFoundError);
  });
});
