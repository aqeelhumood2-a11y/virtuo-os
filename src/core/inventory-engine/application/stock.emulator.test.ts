// @vitest-environment node
//
// This file does no DOM work at all, and running it under the project's
// default jsdom environment was found to break Firestore transaction
// conflict-detection timing specifically for concurrent runTransaction()
// calls -- a guard-free probe doing nothing but adminDb.runTransaction()
// reproducibly lost an update under jsdom and reproducibly did not under
// plain Node, against the same emulator, same project, same code. See
// docs/phases/PHASE_1E_PLAN.md §10.
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the real Firestore transactions in stock.ts against the real
// emulator -- a mock structurally cannot prove genuine concurrent-write
// retry behavior or true multi-document atomicity (see
// docs/phases/PHASE_1C_PLAN.md §8 for the same argument applied to
// onboarding's transaction). Only the session layer is faked (there's no
// real HTTP request here to carry a cookie); adminDb itself is untouched
// and talks to the real Firestore Emulator. Run via `npm run test:emulator`;
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

async function seedCompanyAndItem(
  companyId: string,
  uid: string,
  itemId: string,
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
}

describe.skipIf(!IS_EMULATOR)("inventory-engine stock transactions (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "applies concurrent receiveStock calls without losing an update",
    async () => {
      const companyId = `company-${randomUUID()}`;
      const uid = `uid-${randomUUID()}`;
      const itemId = `item-${randomUUID()}`;
      await seedCompanyAndItem(companyId, uid, itemId);
      requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

      const { receiveStock, getStockLevel } = await import("./stock");

      await Promise.all([
        receiveStock(companyId, "branch-1", itemId, 5),
        receiveStock(companyId, "branch-1", itemId, 7),
      ]);

      const stock = await getStockLevel(companyId, "branch-1", itemId);
      expect(stock?.quantityOnHand).toBe(12);
    },
    // Two genuine concurrent Firestore transactions -- the default 5s
    // budget is tight when the full suite's ~28 files are contending for
    // CPU/scheduling in this sandbox (this test alone takes ~2s in
    // isolation); a generous ceiling avoids a false failure under
    // contention without masking a real hang.
    20000,
  );

  it("rejects wasting more than is on hand, leaving quantityOnHand unchanged", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { receiveStock, wasteStock, getStockLevel } = await import("./stock");
    const { InsufficientStockError } = await import("../domain/errors");
    await receiveStock(companyId, "branch-1", itemId, 5);

    await expect(wasteStock(companyId, "branch-1", itemId, 10, "spoilage")).rejects.toThrow(InsufficientStockError);

    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand).toBe(5);
  });

  it("transfers atomically between two branches, writing linked movements", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { receiveStock, transferStock, getStockLevel, listMovementsForBranch } = await import("./stock");
    await receiveStock(companyId, "branch-1", itemId, 10);

    await transferStock(companyId, "branch-1", "branch-2", itemId, 4);

    const fromStock = await getStockLevel(companyId, "branch-1", itemId);
    const toStock = await getStockLevel(companyId, "branch-2", itemId);
    expect(fromStock?.quantityOnHand).toBe(6);
    expect(toStock?.quantityOnHand).toBe(4);

    const fromMovements = await listMovementsForBranch(companyId, "branch-1");
    const toMovements = await listMovementsForBranch(companyId, "branch-2");
    const outMovement = fromMovements.find((m) => m.type === "transfer");
    const inMovement = toMovements.find((m) => m.type === "transfer");
    expect(outMovement?.quantityDelta).toBe(-4);
    expect(inMovement?.quantityDelta).toBe(4);
    expect(outMovement?.transferGroupId).toBeTruthy();
    expect(outMovement?.transferGroupId).toBe(inMovement?.transferGroupId);
  });

  it("rejects a transfer with insufficient source stock, leaving both branches unchanged (all-or-nothing)", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { receiveStock, transferStock, getStockLevel } = await import("./stock");
    const { InsufficientStockError } = await import("../domain/errors");
    await receiveStock(companyId, "branch-1", itemId, 2);

    await expect(transferStock(companyId, "branch-1", "branch-2", itemId, 5)).rejects.toThrow(
      InsufficientStockError,
    );

    const fromStock = await getStockLevel(companyId, "branch-1", itemId);
    const toStock = await getStockLevel(companyId, "branch-2", itemId);
    expect(fromStock?.quantityOnHand).toBe(2);
    expect(toStock).toBeNull();
  });

  it("denies stock mutation to a member whose branchIds excludes the target branch", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId, { branchIds: ["branch-2"] });
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { receiveStock } = await import("./stock");
    const { BranchAccessDeniedError } = await import("../domain/errors");

    await expect(receiveStock(companyId, "branch-1", itemId, 5)).rejects.toThrow(BranchAccessDeniedError);
  });

  it("records a stock count as a single adjust movement with the correct delta", async () => {
    const companyId = `company-${randomUUID()}`;
    const uid = `uid-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    await seedCompanyAndItem(companyId, uid, itemId);
    requireSessionMock.mockResolvedValue({ uid, email: null, superAdmin: false });

    const { receiveStock, recordStockCount, getStockLevel, listMovementsForBranch } = await import("./stock");
    await receiveStock(companyId, "branch-1", itemId, 10);

    await recordStockCount(companyId, "branch-1", itemId, 8);

    const stock = await getStockLevel(companyId, "branch-1", itemId);
    expect(stock?.quantityOnHand).toBe(8);

    const movements = await listMovementsForBranch(companyId, "branch-1");
    const countMovement = movements.find((m) => m.reason === "count");
    expect(countMovement?.quantityDelta).toBe(-2);
  });
});
