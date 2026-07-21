// @vitest-environment node
//
// Pinned to node for the same reason as core/order-engine's and
// apps/restaurant's own emulator tests: no DOM work, and jsdom was found to
// break Firestore transaction conflict-detection timing.
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

async function seedCompanyAndItem(companyId: string, uid: string, itemId: string, branchId: string) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme Retail", ownerId: uid, status: "active" });
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
    .set({ branchId, itemId, quantityOnHand: 50, reorderPoint: 0 });
}

describe.skipIf(!IS_EMULATOR)("apps/retail sale.service (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a Core order for the cart's lines, appId 'retail'", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createSale } = await import("./sale.service");
    const sale = await createSale(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 3, unitPrice: 9.99 }],
    });

    expect(sale.status).toBe("pending");
    expect(sale.appId).toBe("retail");
    expect(sale.totals.total).toBeCloseTo(29.97);
  });

  it("two concurrent createSale calls with the same draftId produce exactly one Core order", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createSale } = await import("./sale.service");
    const draftId = `draft-${randomUUID()}`;
    const params = {
      draftId,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
    };

    const [first, second] = await Promise.all([createSale(companyId, params), createSale(companyId, params)]);

    expect(first.id).toBe(second.id);

    const { adminDb } = await import("@/lib/firebase/admin");
    const ordersSnap = await adminDb.collection("companies").doc(companyId).collection("orders").get();
    expect(ordersSnap.docs).toHaveLength(1);
  }, 20000);

  it("addLine/updateLineQuantity/removeLine delegate straight to Core, recomputing totals", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createSale, addLine, updateLineQuantity, removeLine } = await import("./sale.service");
    const { listOrderLines, getOrder } = await import("@/core");

    const sale = await createSale(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 10 }],
    });

    await addLine(companyId, sale.id, { itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 10 });
    let lines = await listOrderLines(companyId, sale.id);
    expect(lines).toHaveLength(2);

    await updateLineQuantity(companyId, sale.id, lines[1].id, 3);
    let order = await getOrder(companyId, sale.id);
    expect(order?.totals.total).toBe(10 + 30);

    await removeLine(companyId, sale.id, lines[0].id);
    lines = await listOrderLines(companyId, sale.id);
    expect(lines).toHaveLength(1);
    order = await getOrder(companyId, sale.id);
    expect(order?.totals.total).toBe(30);
  });

  it("completeSale completes the Core order and deducts stock; voidSale voids it", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createSale, completeSale } = await import("./sale.service");
    const { getOrder, getStockLevel } = await import("@/core");

    const sale = await createSale(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 5, unitPrice: 9.99 }],
    });
    await completeSale(companyId, sale.id);

    const order = await getOrder(companyId, sale.id);
    expect(order?.status).toBe("completed");
    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand).toBe(45);
  });

  it("voidSale voids a pending Core order", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createSale, voidSale } = await import("./sale.service");
    const { getOrder } = await import("@/core");

    const sale = await createSale(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
    });
    await voidSale(companyId, sale.id, uid);

    const order = await getOrder(companyId, sale.id);
    expect(order?.status).toBe("voided");
  });

  it("listSaleHistory and listPendingSales reflect Core's own order list for the branch", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createSale, completeSale, listSaleHistory, listPendingSales } = await import("./sale.service");

    const pending = await createSale(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
    });
    const completed = await createSale(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: 9.99 }],
    });
    await completeSale(companyId, completed.id);

    const history = await listSaleHistory(companyId, "branch-1");
    expect(history.map((order) => order.id).sort()).toEqual([completed.id, pending.id].sort());

    const pendingOnly = await listPendingSales(companyId, "branch-1");
    expect(pendingOnly.map((order) => order.id)).toEqual([pending.id]);
  });
});
