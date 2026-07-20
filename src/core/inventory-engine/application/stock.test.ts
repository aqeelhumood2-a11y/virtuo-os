import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const hasBranchAccessMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

const itemGetMock = vi.fn();
const stockGetMock = vi.fn();
const stockSetMock = vi.fn();
const movementSetMock = vi.fn();

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
          doc: () => {
            if (name === "inventoryItems") return { get: itemGetMock };
            if (name === "stock") return { get: stockGetMock, set: (...args: unknown[]) => stockSetMock(...args) };
            return { id: "movement-id", set: (...args: unknown[]) => movementSetMock(...args) };
          },
          where: () => ({ get: vi.fn() }),
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
