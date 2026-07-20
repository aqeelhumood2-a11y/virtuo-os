import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { hasBranchAccess } from "@/core/companies/membership";
import type { CompanyMembershipContext } from "@/core/companies/membership";
import { requireCapability } from "@/core/roles-permissions";
import type { Capability } from "@/core/roles-permissions";

import { BranchAccessDeniedError, ItemNotFoundError } from "../domain/errors";
import { assertSufficientStock, computeCountDelta } from "../domain/stock-math";
import type { InventoryMovement, MovementType, Stock } from "../domain/types";
import {
  itemDoc,
  movementsCollection,
  stockCollection,
  stockDoc,
  toMovement,
  toStock,
} from "../infrastructure/refs";

// Capability alone isn't enough for anything branch-scoped: a Supervisor
// might have inventory.view/write but be restricted to a subset of
// branches via their membership's branchIds (1C). This re-checks that on
// every call, the same way core/companies/members-actions.ts re-checks
// outranks() on top of a capability gate.
async function assertBranchAccess(
  companyId: string,
  capability: Capability,
  branchId: string,
): Promise<CompanyMembershipContext> {
  const context = await requireCapability(companyId, capability);
  if (!hasBranchAccess(context.membership, branchId)) {
    throw new BranchAccessDeniedError();
  }
  return context;
}

export async function getStockLevel(companyId: string, branchId: string, itemId: string): Promise<Stock | null> {
  await assertBranchAccess(companyId, "inventory.view", branchId);
  const snap = await stockDoc(companyId, branchId, itemId).get();
  if (!snap.exists) return null;
  return toStock(snap.id, snap.data()!);
}

export async function listStockForBranch(companyId: string, branchId: string): Promise<Stock[]> {
  await assertBranchAccess(companyId, "inventory.view", branchId);
  const snap = await stockCollection(companyId).where("branchId", "==", branchId).get();
  return snap.docs.map((doc) => toStock(doc.id, doc.data()));
}

export async function listMovementsForBranch(companyId: string, branchId: string): Promise<InventoryMovement[]> {
  await assertBranchAccess(companyId, "inventory.view", branchId);
  const snap = await movementsCollection(companyId).where("branchId", "==", branchId).get();
  return snap.docs.map((doc) => toMovement(doc.id, doc.data()));
}

type ApplyStockChangeParams = {
  companyId: string;
  branchId: string;
  itemId: string;
  type: MovementType;
  reason: string;
  performedBy: string;
  // Computed from the quantity read *inside* the transaction, never from a
  // value read beforehand -- this is what keeps recordStockCount() race-free
  // (a naive "read now, write later" would let a concurrent movement land
  // in between and silently overwrite it).
  computeDelta: (quantityOnHand: number) => number;
};

async function applyStockChange(params: ApplyStockChangeParams): Promise<void> {
  const { companyId, branchId, itemId, type, reason, performedBy, computeDelta } = params;

  const itemRef = itemDoc(companyId, itemId);
  const stockRef = stockDoc(companyId, branchId, itemId);
  const movementRef = movementsCollection(companyId).doc();

  await adminDb.runTransaction(async (transaction: Transaction) => {
    // Sequential, not Promise.all -- reading multiple docs concurrently
    // inside a transaction was observed to break the SDK's read-set
    // tracking against the emulator (the optimistic-concurrency conflict
    // that should force a retry on concurrent writers silently didn't
    // fire, losing an update). Matches onboarding.ts's proven sequential
    // read pattern.
    const itemSnap = await transaction.get(itemRef);
    if (!itemSnap.exists) throw new ItemNotFoundError();
    const stockSnap = await transaction.get(stockRef);

    const currentQuantity: number = stockSnap.exists ? (stockSnap.data()?.quantityOnHand ?? 0) : 0;
    const quantityDelta = computeDelta(currentQuantity);
    if (quantityDelta === 0) return;

    assertSufficientStock(currentQuantity, quantityDelta);

    const now = FieldValue.serverTimestamp();

    transaction.set(
      stockRef,
      {
        branchId,
        itemId,
        quantityOnHand: currentQuantity + quantityDelta,
        reorderPoint: stockSnap.exists ? (stockSnap.data()?.reorderPoint ?? 0) : 0,
        updatedAt: now,
      },
      { merge: true },
    );

    transaction.set(movementRef, {
      itemId,
      branchId,
      type,
      quantityDelta,
      itemNameSnapshot: itemSnap.data()?.name ?? itemId,
      reason,
      performedBy,
      createdAt: now,
    });
  });
}

export async function receiveStock(
  companyId: string,
  branchId: string,
  itemId: string,
  quantity: number,
  reason = "receive",
): Promise<void> {
  if (quantity <= 0) throw new Error("Quantity must be positive.");
  const { session } = await assertBranchAccess(companyId, "inventory.write", branchId);
  await applyStockChange({
    companyId,
    branchId,
    itemId,
    type: "receive",
    reason,
    performedBy: session.uid,
    computeDelta: () => quantity,
  });
}

export async function wasteStock(
  companyId: string,
  branchId: string,
  itemId: string,
  quantity: number,
  reason: string,
): Promise<void> {
  if (quantity <= 0) throw new Error("Quantity must be positive.");
  const { session } = await assertBranchAccess(companyId, "inventory.write", branchId);
  await applyStockChange({
    companyId,
    branchId,
    itemId,
    type: "waste",
    reason,
    performedBy: session.uid,
    computeDelta: () => -quantity,
  });
}

export async function adjustStock(
  companyId: string,
  branchId: string,
  itemId: string,
  quantityDelta: number,
  reason: string,
): Promise<void> {
  if (quantityDelta === 0) throw new Error("Adjustment delta must be non-zero.");
  const { session } = await assertBranchAccess(companyId, "inventory.write", branchId);
  await applyStockChange({
    companyId,
    branchId,
    itemId,
    type: "adjust",
    reason,
    performedBy: session.uid,
    computeDelta: () => quantityDelta,
  });
}

export async function recordStockCount(
  companyId: string,
  branchId: string,
  itemId: string,
  countedQuantity: number,
): Promise<void> {
  if (countedQuantity < 0) throw new Error("Counted quantity cannot be negative.");
  const { session } = await assertBranchAccess(companyId, "inventory.write", branchId);
  await applyStockChange({
    companyId,
    branchId,
    itemId,
    type: "adjust",
    reason: "count",
    performedBy: session.uid,
    computeDelta: (quantityOnHand) => computeCountDelta(quantityOnHand, countedQuantity),
  });
}

export async function transferStock(
  companyId: string,
  fromBranchId: string,
  toBranchId: string,
  itemId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) throw new Error("Quantity must be positive.");
  if (fromBranchId === toBranchId) throw new Error("Source and destination branches must differ.");

  const context = await requireCapability(companyId, "inventory.write");
  if (!hasBranchAccess(context.membership, fromBranchId) || !hasBranchAccess(context.membership, toBranchId)) {
    throw new BranchAccessDeniedError();
  }

  const itemRef = itemDoc(companyId, itemId);
  const fromStockRef = stockDoc(companyId, fromBranchId, itemId);
  const toStockRef = stockDoc(companyId, toBranchId, itemId);
  const transferGroupId = movementsCollection(companyId).doc().id;
  const outMovementRef = movementsCollection(companyId).doc();
  const inMovementRef = movementsCollection(companyId).doc();

  await adminDb.runTransaction(async (transaction: Transaction) => {
    // Sequential reads -- see the comment in applyStockChange() above.
    const itemSnap = await transaction.get(itemRef);
    if (!itemSnap.exists) throw new ItemNotFoundError();
    const fromSnap = await transaction.get(fromStockRef);
    const toSnap = await transaction.get(toStockRef);

    const fromQuantity: number = fromSnap.exists ? (fromSnap.data()?.quantityOnHand ?? 0) : 0;
    const toQuantity: number = toSnap.exists ? (toSnap.data()?.quantityOnHand ?? 0) : 0;

    assertSufficientStock(fromQuantity, -quantity);

    const now = FieldValue.serverTimestamp();
    const itemName = itemSnap.data()?.name ?? itemId;

    transaction.set(
      fromStockRef,
      {
        branchId: fromBranchId,
        itemId,
        quantityOnHand: fromQuantity - quantity,
        reorderPoint: fromSnap.exists ? (fromSnap.data()?.reorderPoint ?? 0) : 0,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.set(
      toStockRef,
      {
        branchId: toBranchId,
        itemId,
        quantityOnHand: toQuantity + quantity,
        reorderPoint: toSnap.exists ? (toSnap.data()?.reorderPoint ?? 0) : 0,
        updatedAt: now,
      },
      { merge: true },
    );

    transaction.set(outMovementRef, {
      itemId,
      branchId: fromBranchId,
      type: "transfer",
      quantityDelta: -quantity,
      itemNameSnapshot: itemName,
      reason: "transfer",
      performedBy: context.session.uid,
      transferGroupId,
      createdAt: now,
    });
    transaction.set(inMovementRef, {
      itemId,
      branchId: toBranchId,
      type: "transfer",
      quantityDelta: quantity,
      itemNameSnapshot: itemName,
      reason: "transfer",
      performedBy: context.session.uid,
      transferGroupId,
      createdAt: now,
    });
  });
}
