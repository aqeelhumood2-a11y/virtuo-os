import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const hasBranchAccessMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

const itemGetMock = vi.fn();
const stockGetMock = vi.fn();
const stockSetMock = vi.fn();
const movementSetMock = vi.fn();
const stockWhereGetMock = vi.fn();
const movementsWhereGetMock = vi.fn();
const whereOrderByMock = vi.fn();
const whereLimitMock = vi.fn();
const whereStartAfterMock = vi.fn();
const movementsCursorDocGetMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

vi.mock("@/core/companies/membership", () => ({
  hasBranchAccess: (...args: unknown[]) => hasBranchAccessMock(...args),
}));

// Audit logging (1G) is exercised for real in the emulator tests; here it's
// mocked out so it doesn't need its own auditLogs-collection entry in the
// fake adminDb below, which only models inventoryItems/stock/movements.
vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

// A fake Firestore transaction: each mocked doc ref carries its own
// get/set so the fake transaction.get(ref)/set(ref, ...) can just forward
// to it, with no need to track ref identity by path. Good enough to prove
// the *use-case's* logic (delta computation, insufficient-stock guard,
// no-op on zero delta) without needing the real emulator -- the real
// emulator tests separately prove genuine transactional atomicity/retry,
// which a mock structurally can't.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({
          doc: (id?: string) => {
            if (name === "inventoryItems") return { get: itemGetMock };
            if (name === "stock") return { get: stockGetMock, set: (...args: unknown[]) => stockSetMock(...args) };
            // "inventoryMovements": also doubles as the cursor-resolution
            // doc() call applyCursor() makes on the same collection ref
            // (see lib/firebase/pagination.ts) -- movementsCursorDocGetMock
            // covers that case, id is otherwise unused (fake writes always
            // resolve to the same fixed "movement-id").
            return { id: id ?? "movement-id", get: movementsCursorDocGetMock, set: (...args: unknown[]) => movementSetMock(...args) };
          },
          where: () => {
            const isMovements = name === "inventoryMovements";
            const getMock = isMovements ? movementsWhereGetMock : stockWhereGetMock;
            const ref = {
              get: getMock,
              orderBy: (...orderByArgs: unknown[]) => {
                whereOrderByMock(...orderByArgs);
                return ref;
              },
              limit: (...limitArgs: unknown[]) => {
                whereLimitMock(...limitArgs);
                return ref;
              },
              startAfter: (...startAfterArgs: unknown[]) => {
                whereStartAfterMock(...startAfterArgs);
                return ref;
              },
            };
            return ref;
          },
        }),
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown, opts?: unknown) => ref.set(data, opts),
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
  hasBranchAccessMock.mockReturnValue(true);
  itemGetMock.mockResolvedValue({ exists: true, data: () => ({ name: "Widget" }) });
  stockGetMock.mockResolvedValue({ exists: true, data: () => ({ quantityOnHand: 10, reorderPoint: 2 }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("branch-access enforcement (shared across all mutations)", () => {
  it("denies when the actor's branchIds does not include the target branch", async () => {
    hasBranchAccessMock.mockReturnValue(false);
    const { receiveStock } = await import("./stock");
    const { BranchAccessDeniedError } = await import("@/core/companies/errors");

    await expect(receiveStock("company-1", "branch-2", "item-1", 5)).rejects.toThrow(BranchAccessDeniedError);
    expect(stockSetMock).not.toHaveBeenCalled();
  });

  it("checks the capability before checking branch access", async () => {
    const { receiveStock } = await import("./stock");
    await receiveStock("company-1", "branch-1", "item-1", 5);

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.write");
    expect(hasBranchAccessMock).toHaveBeenCalledWith(
      { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
      "branch-1",
    );
  });
});

describe("input validation", () => {
  it("rejects a non-positive quantity for receiveStock/wasteStock before any capability check", async () => {
    const { receiveStock, wasteStock } = await import("./stock");
    await expect(receiveStock("company-1", "branch-1", "item-1", 0)).rejects.toThrow(/positive/i);
    await expect(wasteStock("company-1", "branch-1", "item-1", -1, "spoilage")).rejects.toThrow(/positive/i);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it("rejects a zero delta for adjustStock", async () => {
    const { adjustStock } = await import("./stock");
    await expect(adjustStock("company-1", "branch-1", "item-1", 0, "correction")).rejects.toThrow(/non-zero/i);
  });

  it("rejects transferring to the same branch", async () => {
    const { transferStock } = await import("./stock");
    await expect(transferStock("company-1", "branch-1", "branch-1", "item-1", 5)).rejects.toThrow(/must differ/i);
  });
});

describe("receiveStock", () => {
  it("increments quantityOnHand and writes a receive movement", async () => {
    const { receiveStock } = await import("./stock");
    await receiveStock("company-1", "branch-1", "item-1", 5);

    expect(stockSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ quantityOnHand: 15 }),
      { merge: true },
    );
    expect(movementSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "receive", quantityDelta: 5, performedBy: "owner-1" }),
      undefined,
    );
  });

  it("treats a missing stock doc as a zero baseline", async () => {
    stockGetMock.mockResolvedValue({ exists: false });
    const { receiveStock } = await import("./stock");
    await receiveStock("company-1", "branch-1", "item-1", 5);

    expect(stockSetMock).toHaveBeenCalledWith(expect.objectContaining({ quantityOnHand: 5 }), { merge: true });
  });
});

describe("wasteStock / adjustStock: insufficient stock", () => {
  it("rejects wasting more than is on hand and writes nothing", async () => {
    const { wasteStock } = await import("./stock");
    const { InsufficientStockError } = await import("../domain/errors");

    await expect(wasteStock("company-1", "branch-1", "item-1", 20, "spoilage")).rejects.toThrow(InsufficientStockError);
    expect(stockSetMock).not.toHaveBeenCalled();
    expect(movementSetMock).not.toHaveBeenCalled();
  });

  it("allows a negative adjustment down to exactly zero", async () => {
    const { adjustStock } = await import("./stock");
    await adjustStock("company-1", "branch-1", "item-1", -10, "correction");

    expect(stockSetMock).toHaveBeenCalledWith(expect.objectContaining({ quantityOnHand: 0 }), { merge: true });
  });
});

describe("recordStockCount", () => {
  it("writes an adjust movement for the computed delta when the count differs", async () => {
    const { recordStockCount } = await import("./stock");
    await recordStockCount("company-1", "branch-1", "item-1", 12);

    expect(stockSetMock).toHaveBeenCalledWith(expect.objectContaining({ quantityOnHand: 12 }), { merge: true });
    expect(movementSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "adjust", reason: "count", quantityDelta: 2 }),
      undefined,
    );
  });

  it("is a no-op (no writes) when the count matches quantityOnHand", async () => {
    const { recordStockCount } = await import("./stock");
    await recordStockCount("company-1", "branch-1", "item-1", 10);

    expect(stockSetMock).not.toHaveBeenCalled();
    expect(movementSetMock).not.toHaveBeenCalled();
  });
});

describe("transferStock", () => {
  it("requires branch access to both the source and destination branch", async () => {
    hasBranchAccessMock.mockImplementation(
      (_membership: unknown, branchId: string) => branchId === "branch-1",
    );
    const { transferStock } = await import("./stock");
    const { BranchAccessDeniedError } = await import("@/core/companies/errors");

    await expect(transferStock("company-1", "branch-1", "branch-2", "item-1", 5)).rejects.toThrow(
      BranchAccessDeniedError,
    );
  });

  it("decrements the source, increments the destination, and links both movements by transferGroupId", async () => {
    stockGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ quantityOnHand: 10, reorderPoint: 2 }) }) // from
      .mockResolvedValueOnce({ exists: false }); // to (no stock doc yet at destination)

    const { transferStock } = await import("./stock");
    await transferStock("company-1", "branch-1", "branch-2", "item-1", 4);

    expect(stockSetMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ branchId: "branch-1", quantityOnHand: 6 }),
      { merge: true },
    );
    expect(stockSetMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ branchId: "branch-2", quantityOnHand: 4 }),
      { merge: true },
    );

    const [outMovement] = movementSetMock.mock.calls[0];
    const [inMovement] = movementSetMock.mock.calls[1];
    expect(outMovement).toMatchObject({ branchId: "branch-1", quantityDelta: -4, type: "transfer" });
    expect(inMovement).toMatchObject({ branchId: "branch-2", quantityDelta: 4, type: "transfer" });
    expect(outMovement.transferGroupId).toBe(inMovement.transferGroupId);
  });

  it("rejects when the source branch has insufficient stock, writing nothing", async () => {
    stockGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ quantityOnHand: 2, reorderPoint: 0 }) })
      .mockResolvedValueOnce({ exists: false });

    const { transferStock } = await import("./stock");
    const { InsufficientStockError } = await import("../domain/errors");

    await expect(transferStock("company-1", "branch-1", "branch-2", "item-1", 5)).rejects.toThrow(
      InsufficientStockError,
    );
    expect(stockSetMock).not.toHaveBeenCalled();
    expect(movementSetMock).not.toHaveBeenCalled();
  });
});

describe("ItemNotFoundError", () => {
  it("is thrown when the item doc doesn't exist, before any stock write", async () => {
    itemGetMock.mockResolvedValue({ exists: false });
    const { receiveStock } = await import("./stock");
    const { ItemNotFoundError } = await import("../domain/errors");

    await expect(receiveStock("company-1", "branch-1", "ghost-item", 5)).rejects.toThrow(ItemNotFoundError);
    expect(stockSetMock).not.toHaveBeenCalled();
  });
});

function fakeQuerySnapshot(docs: Record<string, unknown>[]) {
  return { docs: docs.map((data, index) => ({ id: `doc-${index}`, data: () => data })) };
}

describe("listStockForBranch", () => {
  it("requires inventory.view/branch access and bounds the read with MAX_UNBOUNDED_LIST_SIZE", async () => {
    stockWhereGetMock.mockResolvedValue(fakeQuerySnapshot([{ branchId: "branch-1", itemId: "item-1", quantityOnHand: 3 }]));
    const { listStockForBranch } = await import("./stock");

    const result = await listStockForBranch("company-1", "branch-1");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.view");
    expect(whereLimitMock).toHaveBeenCalledWith(500);
    expect(result).toHaveLength(1);
  });

  it("denies branch access", async () => {
    hasBranchAccessMock.mockReturnValue(false);
    const { listStockForBranch } = await import("./stock");
    const { BranchAccessDeniedError } = await import("@/core/companies/errors");

    await expect(listStockForBranch("company-1", "branch-1")).rejects.toThrow(BranchAccessDeniedError);
    expect(stockWhereGetMock).not.toHaveBeenCalled();
  });
});

describe("listMovementsForBranch", () => {
  it("requires inventory.view/branch access and bounds the read with MAX_UNBOUNDED_LIST_SIZE", async () => {
    movementsWhereGetMock.mockResolvedValue(fakeQuerySnapshot([{ branchId: "branch-1", itemId: "item-1", type: "receive", quantityDelta: 5 }]));
    const { listMovementsForBranch } = await import("./stock");

    const result = await listMovementsForBranch("company-1", "branch-1");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.view");
    expect(whereLimitMock).toHaveBeenCalledWith(500);
    expect(result).toHaveLength(1);
  });
});

describe("listMovementsPage", () => {
  it("requires inventory.view/branch access and orders newest-first, limited to the requested page size", async () => {
    movementsWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listMovementsPage } = await import("./stock");

    await listMovementsPage("company-1", "branch-1", { limit: 10 });

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "inventory.view");
    expect(whereOrderByMock).toHaveBeenCalledWith("createdAt", "desc");
    expect(whereLimitMock).toHaveBeenCalledWith(10);
  });

  it("defaults to a page size of 50 when no limit is given", async () => {
    movementsWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listMovementsPage } = await import("./stock");

    await listMovementsPage("company-1", "branch-1");

    expect(whereLimitMock).toHaveBeenCalledWith(50);
  });

  it("returns nextCursor as the last movement's id when a full page comes back", async () => {
    movementsWhereGetMock.mockResolvedValue(
      fakeQuerySnapshot([
        { branchId: "branch-1", itemId: "item-1", type: "receive", quantityDelta: 5 },
        { branchId: "branch-1", itemId: "item-1", type: "receive", quantityDelta: 3 },
      ]),
    );
    const { listMovementsPage } = await import("./stock");

    const page = await listMovementsPage("company-1", "branch-1", { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("doc-1");
  });

  it("returns nextCursor: null when fewer docs than the limit come back (last page)", async () => {
    movementsWhereGetMock.mockResolvedValue(
      fakeQuerySnapshot([{ branchId: "branch-1", itemId: "item-1", type: "receive", quantityDelta: 5 }]),
    );
    const { listMovementsPage } = await import("./stock");

    const page = await listMovementsPage("company-1", "branch-1", { limit: 10 });
    expect(page.nextCursor).toBeNull();
  });

  it("resolves a given cursor to a document snapshot and passes it to startAfter", async () => {
    movementsCursorDocGetMock.mockResolvedValue({ exists: true, id: "movement-1" });
    movementsWhereGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listMovementsPage } = await import("./stock");

    await listMovementsPage("company-1", "branch-1", { cursor: "movement-1" });

    expect(whereStartAfterMock).toHaveBeenCalledWith({ exists: true, id: "movement-1" });
  });

  it("denies branch access before reading Firestore", async () => {
    hasBranchAccessMock.mockReturnValue(false);
    const { listMovementsPage } = await import("./stock");
    const { BranchAccessDeniedError } = await import("@/core/companies/errors");

    await expect(listMovementsPage("company-1", "branch-1")).rejects.toThrow(BranchAccessDeniedError);
    expect(movementsWhereGetMock).not.toHaveBeenCalled();
  });
});
