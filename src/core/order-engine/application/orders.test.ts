import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const hasBranchAccessMock = vi.fn();
const planStockChangeMock = vi.fn();
const commitStockChangePlanMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

const orderGetMock = vi.fn();
const orderSetMock = vi.fn();
const orderUpdateMock = vi.fn();
const ordersWhereGetMock = vi.fn();
const lineSetMock = vi.fn();
const linesGetMock = vi.fn();
const lineGetMock = vi.fn();
const lineUpdateMock = vi.fn();
const lineDeleteMock = vi.fn();
const idempotencyGetMock = vi.fn();
const idempotencySetMock = vi.fn();
const ordersOrderByMock = vi.fn();
const ordersLimitMock = vi.fn();
const ordersStartAfterMock = vi.fn();

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

// Audit logging (1G) is exercised for real in the emulator tests; here it's
// mocked out so it doesn't need its own auditLogs-collection entry in the
// fake adminDb below, which only models the orders/lines collections.
vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

// Same fake-transaction shape as inventory-engine's stock.test.ts: each
// mocked ref carries its own get/set/update so transaction.get/set/update
// can just forward to it, with no need to track ref identity.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => {
          if (name === "idempotencyKeys") {
            return {
              doc: () => ({
                get: idempotencyGetMock,
                set: (...args: unknown[]) => idempotencySetMock(...args),
              }),
            };
          }
          if (name !== "orders") throw new Error(`unexpected collection: ${name}`);
          return {
            doc: () => ({
              id: "order-1",
              get: orderGetMock,
              set: (...args: unknown[]) => orderSetMock(...args),
              update: (...args: unknown[]) => orderUpdateMock(...args),
              collection: (subName: string) => {
                if (subName !== "lines") throw new Error(`unexpected subcollection: ${subName}`);
                return {
                  doc: () => ({
                    set: (...args: unknown[]) => lineSetMock(...args),
                    get: lineGetMock,
                    update: (...args: unknown[]) => lineUpdateMock(...args),
                    delete: () => lineDeleteMock(),
                  }),
                  get: linesGetMock,
                };
              },
            }),
            where: () => {
              const ref = {
                get: ordersWhereGetMock,
                orderBy: (...args: unknown[]) => {
                  ordersOrderByMock(...args);
                  return ref;
                },
                limit: (...args: unknown[]) => {
                  ordersLimitMock(...args);
                  return ref;
                },
                startAfter: (...args: unknown[]) => {
                  ordersStartAfterMock(...args);
                  return ref;
                },
              };
              return ref;
            },
          };
        },
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown, opts?: unknown) => ref.set(data, opts),
        update: (ref: { update: (data: unknown) => void }, data: unknown) => ref.update(data),
        delete: (ref: { delete: () => void }) => ref.delete(),
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
  lineGetMock.mockResolvedValue({ exists: true, id: "line-1", data: () => ({ unitPrice: 5 }) });
  idempotencyGetMock.mockResolvedValue({ exists: false });
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

describe("createOrder with idempotencyKey", () => {
  it("writes the idempotency record alongside the new order when the key is unseen", async () => {
    idempotencyGetMock.mockResolvedValue({ exists: false });
    const { createOrder } = await import("./orders");

    await createOrder(
      "company-1",
      {
        branchId: "branch-1",
        appId: "restaurant",
        lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 1, unitPrice: 5 }],
      },
      { idempotencyKey: "draft-1" },
    );

    expect(orderSetMock).toHaveBeenCalledTimes(1);
    expect(idempotencySetMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "createOrder", resultId: "order-1" }),
      undefined,
    );
  });

  it("returns the existing order instead of creating a second one when the key is already recorded", async () => {
    idempotencyGetMock.mockResolvedValue({ exists: true, data: () => ({ resultId: "existing-order" }) });
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, { ...pendingOrder }));
    const { createOrder } = await import("./orders");

    const result = await createOrder(
      "company-1",
      {
        branchId: "branch-1",
        appId: "restaurant",
        lines: [{ itemId: "item-1", itemNameSnapshot: "Widget", quantity: 1, unitPrice: 5 }],
      },
      { idempotencyKey: "draft-1" },
    );

    expect(orderSetMock).not.toHaveBeenCalled();
    expect(lineSetMock).not.toHaveBeenCalled();
    expect(idempotencySetMock).not.toHaveBeenCalled();
    expect(result.id).toBe("order-1");
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

describe("updateOrderLineQuantity", () => {
  it("rejects a non-positive quantity", async () => {
    const { updateOrderLineQuantity } = await import("./orders");
    await expect(updateOrderLineQuantity("company-1", "order-1", "line-1", 0)).rejects.toThrow(/positive/i);
  });

  it("rejects updating a line on a non-pending order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, completedOrder));
    const { updateOrderLineQuantity } = await import("./orders");
    const { OrderNotEditableError } = await import("../domain/errors");

    await expect(updateOrderLineQuantity("company-1", "order-1", "line-1", 2)).rejects.toThrow(OrderNotEditableError);
    expect(lineUpdateMock).not.toHaveBeenCalled();
  });

  it("throws OrderLineNotFoundError when the line doesn't exist", async () => {
    lineGetMock.mockResolvedValue({ exists: false });
    const { updateOrderLineQuantity } = await import("./orders");
    const { OrderLineNotFoundError } = await import("../domain/errors");

    await expect(updateOrderLineQuantity("company-1", "order-1", "ghost", 2)).rejects.toThrow(OrderLineNotFoundError);
  });

  it("recomputes totals from every other line plus the new quantity", async () => {
    linesGetMock.mockResolvedValue(
      fakeQuerySnapshot([
        { lineTotal: 5 },
        { lineTotal: 20 },
      ]),
    );
    lineGetMock.mockResolvedValue({ exists: true, id: "line-1", data: () => ({ unitPrice: 5 }) });
    const { updateOrderLineQuantity } = await import("./orders");

    // fakeQuerySnapshot assigns ids doc-0/doc-1; the mocked lineDoc() ref
    // always resolves to id "line-1" via lineGetMock, so simulate updating
    // the line identified as "doc-0" being excluded is not testable with
    // this shared-id mock -- assert the shape of the recompute instead.
    await updateOrderLineQuantity("company-1", "order-1", "doc-0", 3);

    expect(lineUpdateMock).toHaveBeenCalledWith({ quantity: 3, lineTotal: 15 });
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ totals: { subtotal: 35, tax: 0, discount: 0, total: 35 } }),
    );
  });
});

describe("removeOrderLine", () => {
  it("rejects removing a line from a non-pending order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(true, completedOrder));
    const { removeOrderLine } = await import("./orders");
    const { OrderNotEditableError } = await import("../domain/errors");

    await expect(removeOrderLine("company-1", "order-1", "line-1")).rejects.toThrow(OrderNotEditableError);
    expect(lineDeleteMock).not.toHaveBeenCalled();
  });

  it("throws OrderLineNotFoundError when the line doesn't exist", async () => {
    lineGetMock.mockResolvedValue({ exists: false });
    const { removeOrderLine } = await import("./orders");
    const { OrderLineNotFoundError } = await import("../domain/errors");

    await expect(removeOrderLine("company-1", "order-1", "ghost")).rejects.toThrow(OrderLineNotFoundError);
  });

  it("deletes the line and recomputes totals from the remaining lines", async () => {
    linesGetMock.mockResolvedValue(fakeQuerySnapshot([{ lineTotal: 5 }, { lineTotal: 20 }]));
    const { removeOrderLine } = await import("./orders");

    await removeOrderLine("company-1", "order-1", "doc-0");

    expect(lineDeleteMock).toHaveBeenCalledTimes(1);
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ totals: { subtotal: 20, tax: 0, discount: 0, total: 20 } }),
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

  it("listOrdersForBranch bounds the read with MAX_UNBOUNDED_LIST_SIZE", async () => {
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listOrdersForBranch } = await import("./orders");
    await listOrdersForBranch("company-1", "branch-1");

    expect(ordersLimitMock).toHaveBeenCalledWith(500);
  });

  it("listOrderLines throws OrderNotFoundError for a missing order", async () => {
    orderGetMock.mockResolvedValue(fakeOrderSnapshot(false));
    const { listOrderLines } = await import("./orders");
    const { OrderNotFoundError } = await import("../domain/errors");
    await expect(listOrderLines("company-1", "ghost")).rejects.toThrow(OrderNotFoundError);
  });
});

describe("listOrdersPage", () => {
  it("requires orders.view/branch access and orders newest-first, limited to the requested page size", async () => {
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listOrdersPage } = await import("./orders");

    await listOrdersPage("company-1", "branch-1", { limit: 10 });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "orders.view");
    expect(hasBranchAccessMock).toHaveBeenCalled();
    expect(ordersOrderByMock).toHaveBeenCalledWith("createdAt", "desc");
    expect(ordersLimitMock).toHaveBeenCalledWith(10);
  });

  it("defaults to a page size of 50 when no limit is given", async () => {
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listOrdersPage } = await import("./orders");

    await listOrdersPage("company-1", "branch-1");

    expect(ordersLimitMock).toHaveBeenCalledWith(50);
  });

  it("returns nextCursor as the last order's id when a full page comes back", async () => {
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([pendingOrder, pendingOrder]));
    const { listOrdersPage } = await import("./orders");

    const page = await listOrdersPage("company-1", "branch-1", { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("doc-1");
  });

  it("returns nextCursor: null when fewer docs than the limit come back (last page)", async () => {
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([pendingOrder]));
    const { listOrdersPage } = await import("./orders");

    const page = await listOrdersPage("company-1", "branch-1", { limit: 10 });
    expect(page.nextCursor).toBeNull();
  });

  it("resolves a given cursor to a document snapshot and passes it to startAfter", async () => {
    orderGetMock.mockResolvedValue({ exists: true, id: "order-1" });
    ordersWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listOrdersPage } = await import("./orders");

    await listOrdersPage("company-1", "branch-1", { cursor: "order-1" });

    expect(ordersStartAfterMock).toHaveBeenCalledWith({ exists: true, id: "order-1" });
  });

  it("denies branch access the same way listOrdersForBranch does", async () => {
    hasBranchAccessMock.mockReturnValue(false);
    const { listOrdersPage } = await import("./orders");
    const { BranchAccessDeniedError } = await import("@/core/companies/errors");

    await expect(listOrdersPage("company-1", "branch-1")).rejects.toThrow(BranchAccessDeniedError);
    expect(ordersWhereGetMock).not.toHaveBeenCalled();
  });
});
