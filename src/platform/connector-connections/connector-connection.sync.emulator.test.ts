// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10).
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerConnector } from "@/connectors";
import type { ConnectorContract, ConnectorSyncParams } from "@/connectors";

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

// A test-only fake connector, registered directly into the real registry
// (the same "prove the platform machinery, not a real external system"
// role custom-api plays in Phase 2) -- no credential, no real network
// call, so this test needs no Secret Manager access. Always reports the
// same one product and echoes back whatever outboundOrders it's handed as
// pushed, letting the test assert Platform's own idempotency/mapping
// behavior across two syncs rather than any one connector's logic.
const fakeSyncConnector: ConnectorContract = {
  id: "fake-sync",
  displayName: "Fake Sync",
  async connect() {
    return { status: "connected" as const };
  },
  async disconnect() {},
  async sync(params?: ConnectorSyncParams) {
    return {
      syncedAt: new Date().toISOString(),
      products: [{ externalId: "ext-gizmo", name: "Gizmo", sku: "GIZMO-1", price: 4.5, quantity: 12 }],
      pushedOrders: (params?.outboundOrders ?? []).map((order) => ({ orderId: order.orderId, externalOrderId: `remote-${order.orderId}` })),
      failedOrderIds: [],
    };
  },
  async onWebhook() {
    return { receivedAt: new Date().toISOString() };
  },
};
registerConnector(fakeSyncConnector);

async function seedCompanyWithCompletedOrder(companyId: string, uid: string, itemId: string, branchId: string) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: uid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(uid)
    .set({ uid, role: "Owner", branchIds: [], status: "active" });
  await adminDb.collection("companies").doc(companyId).collection("licenses").doc("default").set({
    plan: "pro",
    entitledApps: [],
    entitledConnectors: ["fake-sync"],
    seats: 5,
    renewsAt: null,
  });
  await adminDb.collection("companies").doc(companyId).collection("branches").doc(branchId).set({
    name: "Main",
    isActive: true,
    isDefault: true,
  });
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
    appId: "retail",
    lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 2, unitPrice: 9.99 }],
  });
  await completeOrder(companyId, order.id);
  return order.id;
}

describe.skipIf(!IS_EMULATOR)("platform/connector-connections syncConnector (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs inbound products into a new Core Inventory Item and pushes the completed order outbound, then is idempotent on re-sync", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    const branchId = "branch-1";
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const orderId = await seedCompanyWithCompletedOrder(companyId, uid, itemId, branchId);

    const { connectConnector, syncConnector } = await import("./connector-connection.service");
    const { getProductMapping } = await import("./product-mapping.repository");
    const { getOutboundOrderMapping } = await import("./order-mapping.repository");
    const { getItem, listItems } = await import("@/core/inventory-engine");
    const { listAuditLogs } = await import("@/core/audit-logs");

    await connectConnector(companyId, "fake-sync", {});

    const firstSummary = await syncConnector(companyId, "fake-sync");
    expect(firstSummary).toEqual({ syncedAt: expect.any(String), productsSynced: 1, ordersPushed: 1, ordersFailed: 0 });

    const mapping = await getProductMapping(companyId, "fake-sync", "ext-gizmo");
    expect(mapping?.externalQuantity).toBe(12);
    const createdItem = await getItem(companyId, mapping!.itemId);
    expect(createdItem).toEqual(expect.objectContaining({ sku: "GIZMO-1", name: "Gizmo", defaultPrice: 4.5 }));

    const orderMapping = await getOutboundOrderMapping(companyId, "fake-sync", orderId);
    expect(orderMapping).toEqual(
      expect.objectContaining({ status: "pushed", externalOrderId: `remote-${orderId}` }),
    );

    const logs = await listAuditLogs(companyId);
    const syncEntry = logs.find((log) => log.action === "connector.synced");
    expect(syncEntry).toBeDefined();
    expect(syncEntry?.after).toEqual({ productsSynced: 1, ordersPushed: 1, ordersFailed: 0 });

    // Second sync: the same order is already mapped (pushed), so it's
    // never re-selected/re-pushed; the same external product updates the
    // existing Item rather than creating a duplicate.
    const secondSummary = await syncConnector(companyId, "fake-sync");
    expect(secondSummary.ordersPushed).toBe(0);
    expect(secondSummary.productsSynced).toBe(1);

    const mappingAfterResync = await getProductMapping(companyId, "fake-sync", "ext-gizmo");
    expect(mappingAfterResync?.itemId).toBe(mapping!.itemId);

    const items = await listItems(companyId);
    expect(items.filter((item) => item.sku === "GIZMO-1")).toHaveLength(1);
  }, 20000);

  it("throws ConnectorNotConnectedError when syncing a connector that was never connected", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { adminDb } = await import("@/lib/firebase/admin");
    await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: uid, status: "active" });
    await adminDb
      .collection("companies")
      .doc(companyId)
      .collection("memberships")
      .doc(uid)
      .set({ uid, role: "Owner", branchIds: [], status: "active" });

    const { syncConnector, ConnectorNotConnectedError } = await import("./connector-connection.service");
    await expect(syncConnector(companyId, "fake-sync")).rejects.toThrow(ConnectorNotConnectedError);
  });
});
