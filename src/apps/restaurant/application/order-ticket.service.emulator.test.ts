// @vitest-environment node
//
// Pinned to node for the same reason as core/order-engine's own
// orders.emulator.test.ts: no DOM work, and jsdom was found to break
// Firestore transaction conflict-detection timing.
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
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme Diner", ownerId: uid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role: "Owner", branchIds: [], status: "active" });
  await adminDb.collection("companies").doc(companyId).collection("inventoryItems").doc(itemId).set({
    sku: "SKU-1",
    name: "Burger",
    unit: "each",
    category: "food",
    defaultPrice: 10,
    isActive: true,
  });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("stock")
    .doc(`${branchId}_${itemId}`)
    .set({ branchId, itemId, quantityOnHand: 50, reorderPoint: 0 });
}

describe.skipIf(!IS_EMULATOR)("apps/restaurant order-ticket.service (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a Core order and its own orderMeta, keyed by draftId", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createTicket } = await import("./order-ticket.service");
    const { getOrderMeta } = await import("./order-meta.repository");
    const draftId = `draft-${randomUUID()}`;

    const ticket = await createTicket(companyId, {
      draftId,
      branchId: "branch-1",
      orderType: "dineIn",
      tableRef: "Table 4",
      lines: [{ itemId, itemNameSnapshot: "Burger", quantity: 2, unitPrice: 10 }],
    });

    expect(ticket.order.status).toBe("pending");
    expect(ticket.order.totals.total).toBe(20);
    const meta = await getOrderMeta(companyId, draftId);
    expect(meta).toMatchObject({ orderId: ticket.order.id, orderType: "dineIn", tableRef: "Table 4" });
  });

  it("two concurrent createTicket calls with the same draftId produce exactly one Core order", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createTicket } = await import("./order-ticket.service");
    const draftId = `draft-${randomUUID()}`;
    const params = {
      draftId,
      branchId: "branch-1",
      orderType: "dineIn" as const,
      lines: [{ itemId, itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    };

    const [first, second] = await Promise.all([createTicket(companyId, params), createTicket(companyId, params)]);

    expect(first.order.id).toBe(second.order.id);

    const { adminDb } = await import("@/lib/firebase/admin");
    const ordersSnap = await adminDb.collection("companies").doc(companyId).collection("orders").get();
    expect(ordersSnap.docs).toHaveLength(1);

    const orderMetaSnap = await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("apps")
      .doc("restaurant")
      .collection("orderMeta")
      .get();
    expect(orderMetaSnap.docs).toHaveLength(1);
  }, 20000);

  it("repairs metadata deterministically when createTicket is retried after Core's order already exists", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createTicket, completeTicket } = await import("./order-ticket.service");
    const { getOrderMeta } = await import("./order-meta.repository");
    const draftId = `draft-${randomUUID()}`;
    const params = {
      draftId,
      branchId: "branch-1",
      orderType: "takeaway" as const,
      lines: [{ itemId, itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    };

    const first = await createTicket(companyId, params);
    await completeTicket(companyId, first.order.id);

    // Simulate a prior attempt's metadata write never having landed: delete
    // it, then retry createTicket with the exact same draftId + input.
    const { adminDb } = await import("@/lib/firebase/admin");
    await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("apps")
      .doc("restaurant")
      .collection("orderMeta")
      .doc(draftId)
      .delete();

    const repaired = await createTicket(companyId, params);

    expect(repaired.order.id).toBe(first.order.id);
    expect(repaired.order.status).toBe("completed");
    const meta = await getOrderMeta(companyId, draftId);
    expect(meta?.orderId).toBe(first.order.id);

    const auditSnap = await adminDb.collection("companies").doc(companyId).collection("auditLogs").get();
    const repairEntry = auditSnap.docs.find((doc) => doc.data().action === "restaurant.orderMetaRepaired");
    expect(repairEntry).toBeDefined();
  });

  it("addLine/updateLineQuantity/removeLine delegate straight to Core, recomputing totals", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createTicket, addLine, updateLineQuantity, removeLine } = await import("./order-ticket.service");
    const { listOrderLines, getOrder } = await import("@/core");

    const ticket = await createTicket(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      orderType: "delivery",
      lines: [{ itemId, itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });

    await addLine(companyId, ticket.order.id, {
      itemId,
      itemNameSnapshot: "Burger",
      quantity: 1,
      unitPrice: 10,
    });
    let lines = await listOrderLines(companyId, ticket.order.id);
    expect(lines).toHaveLength(2);

    await updateLineQuantity(companyId, ticket.order.id, lines[1].id, 3);
    let order = await getOrder(companyId, ticket.order.id);
    expect(order?.totals.total).toBe(10 + 30);

    await removeLine(companyId, ticket.order.id, lines[0].id);
    lines = await listOrderLines(companyId, ticket.order.id);
    expect(lines).toHaveLength(1);
    order = await getOrder(companyId, ticket.order.id);
    expect(order?.totals.total).toBe(30);
  });

  it("voidTicket voids the Core order", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { createTicket, voidTicket } = await import("./order-ticket.service");
    const { getOrder } = await import("@/core");

    const ticket = await createTicket(companyId, {
      draftId: `draft-${randomUUID()}`,
      branchId: "branch-1",
      orderType: "dineIn",
      lines: [{ itemId, itemNameSnapshot: "Burger", quantity: 1, unitPrice: 10 }],
    });

    await voidTicket(companyId, ticket.order.id, uid);

    const order = await getOrder(companyId, ticket.order.id);
    expect(order?.status).toBe("voided");
  });
});
