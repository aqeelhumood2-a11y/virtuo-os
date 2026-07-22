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

async function seedCompanyAndBarcodedItem(companyId: string, uid: string, itemId: string, branchId: string) {
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
    barcode: "012345678905",
  });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("stock")
    .doc(`${branchId}_${itemId}`)
    .set({ branchId, itemId, quantityOnHand: 10, reorderPoint: 0 });
}

describe.skipIf(!IS_EMULATOR)("barcode (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a real scanned barcode to its Item via getItemByBarcode", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });
    await seedCompanyAndBarcodedItem(companyId, uid, itemId, "branch-1");

    const { lookupByBarcode } = await import("./barcode.service");
    await expect(lookupByBarcode(companyId, "012345678905")).resolves.toEqual(
      expect.objectContaining({ id: itemId, name: "Widget", barcode: "012345678905" }),
    );
    await expect(lookupByBarcode(companyId, "no-such-barcode")).resolves.toBeNull();
  });

  it("with the same draftId, two concurrent quickSale calls produce exactly one order", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });
    await seedCompanyAndBarcodedItem(companyId, uid, itemId, "branch-1");

    const { quickSale } = await import("./barcode.service");
    const draftId = `draft-${randomUUID()}`;
    const params = {
      draftId,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
    };

    const [first, second] = await Promise.all([quickSale(companyId, params), quickSale(companyId, params)]);
    expect(first.id).toBe(second.id);

    const { adminDb } = await import("@/lib/firebase/admin");
    const ordersSnap = await adminDb.collection("companies").doc(companyId).collection("orders").get();
    expect(ordersSnap.docs).toHaveLength(1);
  }, 20000);
});
