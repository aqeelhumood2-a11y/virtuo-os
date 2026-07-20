// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10): this file
// does no DOM work, and the project's default jsdom environment was found
// to break Firestore transaction conflict-detection timing.
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the real Firestore transactions in order-engine against the
// real emulator -- a mock structurally cannot prove genuine cross-engine
// (order + inventory) transactional atomicity. Only the session layer is
// faked; adminDb itself is untouched. Run via `npm run test:emulator`;
// skipped cleanly under plain `npm run test`.
const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const requireSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

async function seedCompanyItemAndStock(
  companyId: string,
  uid: string,
  itemId: string,
  branchId: string,
  initialQuantity: number,
  opts?: { branchIds?: string[] },
) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: uid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role: "Owner", branchIds: opts?.branchIds ?? [], status: "active" });
  await adminDb.collection("companies").doc(companyId).collection("inventoryItems").doc(itemId).set({
    sku: "SKU-1",
    name: "Widget",
    unit: "each",
    category: "general",
    defaultPrice: 9.99,
    isActive: true,
  });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("stock")
    .doc(`${branchId}_${itemId}`)
    .set({ branchId, itemId, quantityOnHand: initialQuantity, reorderPoint: 0 });
}

describe.skipIf(!IS_EMULATOR)("order-engine (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes an order, deducting stock and writing a sale movement", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, itemId, "branch-1", 10);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createOrder, completeOrder, getOrder } = await import("./orders");
    const { getStockLevel, listMovementsForBranch } = await import("@/core/inventory-engine");

    const order = await createOrder(companyId, {
      branchId: "branch-1",
      appId: "retail",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 3, unitPrice: 9.99 }],
    });

    await completeOrder(companyId, order.id);

    const completed = await getOrder(companyId, order.id);
    expect(completed?.status).toBe("completed");

    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand).toBe(7);

    const movements = await listMovementsForBranch(companyId, "branch-1");
    const saleMovement = movements.find((m) => m.type === "sale" && m.reason === "order-completed");
    expect(saleMovement?.quantityDelta).toBe(-3);
  });

  it("aborts the whole order when any line has insufficient stock, leaving stock and status unchanged", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const plentifulItemId = `item-${randomUUID()}`;
    const scarceItemId = `item-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, plentifulItemId, "branch-1", 100);
    await seedCompanyItemAndStock(companyId, uid, scarceItemId, "branch-1", 1);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createOrder, completeOrder, getOrder } = await import("./orders");
    const { getStockLevel } = await import("@/core/inventory-engine");

    const order = await createOrder(companyId, {
      branchId: "branch-1",
      appId: "retail",
      lines: [
        { itemId: plentifulItemId, itemNameSnapshot: "Plentiful", quantity: 5, unitPrice: 1 },
        { itemId: scarceItemId, itemNameSnapshot: "Scarce", quantity: 5, unitPrice: 1 },
      ],
    });

    await expect(completeOrder(companyId, order.id)).rejects.toThrow();

    const stillPending = await getOrder(companyId, order.id);
    expect(stillPending?.status).toBe("pending");

    const plentifulStock = await getStockLevel(companyId, "branch-1", plentifulItemId);
    const scarceStock = await getStockLevel(companyId, "branch-1", scarceItemId);
    expect(plentifulStock?.quantityOnHand).toBe(100);
    expect(scarceStock?.quantityOnHand).toBe(1);
  });

  it("retrying completeOrder on an already-completed order does not double-deduct stock", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, itemId, "branch-1", 10);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createOrder, completeOrder } = await import("./orders");
    const { getStockLevel } = await import("@/core/inventory-engine");
    const { InvalidOrderTransitionError } = await import("../domain/errors");

    const order = await createOrder(companyId, {
      branchId: "branch-1",
      appId: "retail",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 3, unitPrice: 9.99 }],
    });

    await completeOrder(companyId, order.id);
    await expect(completeOrder(companyId, order.id)).rejects.toThrow(InvalidOrderTransitionError);

    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand).toBe(7);
  });

  it("voiding a pending order has no stock effect", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, itemId, "branch-1", 10);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createOrder, voidOrder, getOrder } = await import("./orders");
    const { getStockLevel } = await import("@/core/inventory-engine");

    const order = await createOrder(companyId, {
      branchId: "branch-1",
      appId: "retail",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 3, unitPrice: 9.99 }],
    });

    await voidOrder(companyId, order.id);

    const voided = await getOrder(companyId, order.id);
    expect(voided?.status).toBe("voided");

    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand ?? 10).toBe(10);
  });

  it("voiding a completed order reverses exactly the deducted stock", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, itemId, "branch-1", 10);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createOrder, completeOrder, voidOrder, getOrder } = await import("./orders");
    const { getStockLevel, listMovementsForBranch } = await import("@/core/inventory-engine");

    const order = await createOrder(companyId, {
      branchId: "branch-1",
      appId: "retail",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 3, unitPrice: 9.99 }],
    });
    await completeOrder(companyId, order.id);

    await voidOrder(companyId, order.id);

    const voided = await getOrder(companyId, order.id);
    expect(voided?.status).toBe("voided");

    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand).toBe(10);

    const movements = await listMovementsForBranch(companyId, "branch-1");
    const voidMovement = movements.find((m) => m.reason === "order-voided");
    expect(voidMovement?.quantityDelta).toBe(3);
  });

  it("denies completing an order for a member whose branchIds excludes the order's branch", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyItemAndStock(companyId, uid, itemId, "branch-1", 10);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createOrder, completeOrder } = await import("./orders");
    const order = await createOrder(companyId, {
      branchId: "branch-1",
      appId: "retail",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
    });

    // Re-scope the same uid to a different branch and retry as that member.
    const { adminDb } = await import("@/lib/firebase/admin");
    await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("memberships")
      .doc(uid)
      .set({ uid, role: "Owner", branchIds: ["branch-2"], status: "active" });

    const { BranchAccessDeniedError } = await import("@/core/companies/errors");
    await expect(completeOrder(companyId, order.id)).rejects.toThrow(BranchAccessDeniedError);
  }, 20000);
});
