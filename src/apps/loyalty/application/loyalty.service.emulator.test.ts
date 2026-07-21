// @vitest-environment node
//
// Pinned to node for the same reason as every other App's own emulator
// tests: no DOM work, and jsdom was found to break Firestore transaction
// conflict-detection timing.
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
    defaultPrice: 10,
    isActive: true,
  });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("stock")
    .doc(`${branchId}_${itemId}`)
    .set({ branchId, itemId, quantityOnHand: 100, reorderPoint: 0 });
}

// Creates and completes a real Core order tagged with the given appId --
// the same mechanism Restaurant's/Retail's own emulator tests use, and
// exactly what Loyalty's syncAccruals reads back via the audit log. Using
// Core directly (rather than importing Restaurant's/Retail's own App code)
// is deliberate: it proves Loyalty's accrual is driven entirely by Core's
// own order.completed audit trail, indifferent to which App produced it.
async function createAndCompleteOrder(companyId: string, appId: string, itemId: string, branchId: string, total: number) {
  const { createOrder, completeOrder } = await import("@/core");
  const order = await createOrder(companyId, {
    branchId,
    appId,
    lines: [{ itemId, itemNameSnapshot: "Widget", quantity: 1, unitPrice: total }],
  });
  await completeOrder(companyId, order.id);
  return order.id;
}

describe.skipIf(!IS_EMULATOR)("apps/loyalty loyalty.service (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accrues points identically for a Restaurant-tagged and a Retail-tagged completed order", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { enrollMember, attributeOrderToMember, syncAccruals, getMemberBalance } = await import("./loyalty.service");

    const member = await enrollMember(companyId, uid, { name: "Jane Doe", contactRef: null });

    const restaurantOrderId = await createAndCompleteOrder(companyId, "restaurant", itemId, "branch-1", 20);
    const retailOrderId = await createAndCompleteOrder(companyId, "retail", itemId, "branch-1", 15);

    await attributeOrderToMember(companyId, restaurantOrderId, member.id, uid);
    await attributeOrderToMember(companyId, retailOrderId, member.id, uid);

    const result = await syncAccruals(companyId);
    expect(result.accruedCount).toBe(2);

    const updated = await getMemberBalance(companyId, member.id);
    expect(updated?.pointsBalance).toBe(35); // 20 + 15, at 1 point per currency unit
  });

  it("running syncAccruals twice never double-accrues (idempotent)", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { enrollMember, attributeOrderToMember, syncAccruals, getMemberBalance } = await import("./loyalty.service");

    const member = await enrollMember(companyId, uid, { name: "Jane Doe", contactRef: null });
    const orderId = await createAndCompleteOrder(companyId, "restaurant", itemId, "branch-1", 10);
    await attributeOrderToMember(companyId, orderId, member.id, uid);

    const first = await syncAccruals(companyId);
    expect(first.accruedCount).toBe(1);

    const second = await syncAccruals(companyId);
    expect(second.accruedCount).toBe(0);

    const updated = await getMemberBalance(companyId, member.id);
    expect(updated?.pointsBalance).toBe(10);
  });

  it("an order attributed after its accrual window has passed does not retroactively accrue (documented limitation)", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { enrollMember, attributeOrderToMember, syncAccruals, getMemberBalance } = await import("./loyalty.service");

    const member = await enrollMember(companyId, uid, { name: "Jane Doe", contactRef: null });
    const orderId = await createAndCompleteOrder(companyId, "restaurant", itemId, "branch-1", 10);

    // Sync runs BEFORE attribution -- the cursor advances past this order's
    // order.completed entry with no attribution yet.
    const beforeAttribution = await syncAccruals(companyId);
    expect(beforeAttribution.skippedCount).toBe(1);

    await attributeOrderToMember(companyId, orderId, member.id, uid);
    const afterAttribution = await syncAccruals(companyId);
    expect(afterAttribution.accruedCount).toBe(0); // never retried -- the documented trade-off

    const updated = await getMemberBalance(companyId, member.id);
    expect(updated?.pointsBalance).toBe(0);
  });

  it("attributeOrderToMember rejects attributing an order to a second, different member", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { enrollMember, attributeOrderToMember } = await import("./loyalty.service");
    const { OrderAlreadyAttributedError } = await import("../domain/errors");

    const memberA = await enrollMember(companyId, uid, { name: "Jane", contactRef: null });
    const memberB = await enrollMember(companyId, uid, { name: "Bob", contactRef: null });
    const orderId = await createAndCompleteOrder(companyId, "restaurant", itemId, "branch-1", 10);

    await attributeOrderToMember(companyId, orderId, memberA.id, uid);
    await expect(attributeOrderToMember(companyId, orderId, memberB.id, uid)).rejects.toThrow(
      OrderAlreadyAttributedError,
    );
  });

  it("listLedgerEntriesForMember returns the earned entry after a successful sync", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, "branch-1");
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { enrollMember, attributeOrderToMember, syncAccruals, listLedgerEntriesForMember } = await import(
      "./loyalty.service"
    );

    const member = await enrollMember(companyId, uid, { name: "Jane Doe", contactRef: null });
    const orderId = await createAndCompleteOrder(companyId, "restaurant", itemId, "branch-1", 12);
    await attributeOrderToMember(companyId, orderId, member.id, uid);
    await syncAccruals(companyId);

    const entries = await listLedgerEntriesForMember(companyId, member.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "earned", points: 12, orderId });
  });
});
