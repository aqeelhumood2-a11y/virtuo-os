// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10).
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function seedCompanyItemAndCompletedOrder(companyId: string, uid: string, itemId: string, branchId: string) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: uid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role: "Owner", branchIds: [], status: "active" });
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
    .set({ branchId, itemId, quantityOnHand: 10, reorderPoint: 0 });

  const { createOrder, completeOrder } = await import("@/core/order-engine");
  const order = await createOrder(companyId, {
    branchId,
    appId: "restaurant",
    lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 2, unitPrice: 9.99 }],
  });
  await completeOrder(companyId, order.id);
  return order.id;
}

describe.skipIf(!IS_EMULATOR)("kitchen-display (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults a completed order to queued, then advances its stage and reflects it in listQueueForBranch", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    const branchId = "branch-1";
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const orderId = await seedCompanyItemAndCompletedOrder(companyId, uid, itemId, branchId);

    const { listQueueForBranch, advanceStage, getStageForOrder } = await import("./kitchen-display.service");

    const initialQueue = await listQueueForBranch(companyId, branchId);
    expect(initialQueue).toEqual([{ order: expect.objectContaining({ id: orderId, status: "completed" }), stage: "queued" }]);

    await advanceStage(companyId, orderId, "preparing", uid);
    await expect(getStageForOrder(companyId, orderId)).resolves.toBe("preparing");

    const updatedQueue = await listQueueForBranch(companyId, branchId);
    expect(updatedQueue[0].stage).toBe("preparing");
  }, 20000);

  it("excludes a voided order from the queue", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    const branchId = "branch-1";
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    await seedCompanyItemAndCompletedOrder(companyId, uid, itemId, branchId);
    const { adminDb } = await import("@/lib/firebase/admin");
    const ordersSnap = await adminDb.collection("companies").doc(companyId).collection("orders").get();
    const orderId = ordersSnap.docs[0].id;

    const { voidOrder } = await import("@/core/order-engine");
    await voidOrder(companyId, orderId);

    const { listQueueForBranch } = await import("./kitchen-display.service");
    await expect(listQueueForBranch(companyId, branchId)).resolves.toEqual([]);
  }, 20000);
});
