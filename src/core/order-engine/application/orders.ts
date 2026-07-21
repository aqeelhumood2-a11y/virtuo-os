import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { BranchAccessDeniedError } from "@/core/companies/errors";
import { hasBranchAccess } from "@/core/companies/membership";
import type { CompanyMembershipContext } from "@/core/companies/membership";
import { commitStockChangePlan, planStockChange } from "@/core/inventory-engine";
import type { StockChangePlan } from "@/core/inventory-engine";
import { requireCapability } from "@/core/roles-permissions";
import type { Capability } from "@/core/roles-permissions";

import {
  InvalidOrderTransitionError,
  OrderLineNotFoundError,
  OrderNotEditableError,
  OrderNotFoundError,
} from "../domain/errors";
import { computeLineTotal, computeTotals } from "../domain/pricing";
import { canTransition } from "../domain/state-machine";
import type { Order, OrderLine } from "../domain/types";
import { idempotencyKeyDoc } from "../infrastructure/idempotency";
import {
  lineDoc,
  linesCollection,
  orderDoc,
  ordersCollection,
  toOrder,
  toOrderLine,
} from "../infrastructure/refs";

// Same shape as inventory-engine's own assertBranchAccess (1E) -- capability
// alone isn't enough for anything branch-scoped.
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

// A quick, non-transactional read to learn the order's branchId so the
// guard can run before opening the real transaction, which then re-reads
// the order fresh for the actual mutation -- mirrors how every 1E function
// checks access before ever touching a transaction.
async function requireOrderAccess(
  companyId: string,
  orderId: string,
  capability: Capability,
): Promise<{ context: CompanyMembershipContext; order: Order }> {
  const snap = await orderDoc(companyId, orderId).get();
  if (!snap.exists) throw new OrderNotFoundError();
  const order = toOrder(snap.id, snap.data()!);
  const context = await assertBranchAccess(companyId, capability, order.branchId);
  return { context, order };
}

export type OrderLineInput = {
  itemId: string;
  itemNameSnapshot: string;
  quantity: number;
  unitPrice: number;
};

export type CreateOrderInput = {
  branchId: string;
  appId: string;
  customerRef?: string;
  lines: OrderLineInput[];
  tax?: number;
  discount?: number;
};

function assertValidLineInput(line: OrderLineInput): void {
  if (line.quantity <= 0) throw new Error("Quantity must be positive.");
  if (line.unitPrice < 0) throw new Error("Unit price cannot be negative.");
}

// Optional idempotencyKey lets a caller guarantee that retrying (or
// racing) the exact same logical request never creates a second order --
// see docs/phases/PHASE_3_PLAN.md's idempotency/consistency model. Purely
// additive: existing callers that omit it behave exactly as before.
export type CreateOrderOptions = {
  idempotencyKey?: string;
};

export async function createOrder(
  companyId: string,
  input: CreateOrderInput,
  options?: CreateOrderOptions,
): Promise<Order> {
  if (input.lines.length === 0) throw new Error("An order needs at least one line.");
  input.lines.forEach(assertValidLineInput);

  const { session } = await assertBranchAccess(companyId, "orders.create", input.branchId);

  const orderRef = ordersCollection(companyId).doc();
  const lineTotals = input.lines.map((line) => computeLineTotal(line.quantity, line.unitPrice));
  const totals = computeTotals({ lineTotals, tax: input.tax, discount: input.discount });
  const now = FieldValue.serverTimestamp();
  const idempotencyRef = options?.idempotencyKey
    ? idempotencyKeyDoc(companyId, options.idempotencyKey)
    : null;

  return adminDb.runTransaction(async (transaction: Transaction) => {
    // Every read in this transaction must happen before any write -- so the
    // idempotency check (and, on a hit, the existing order's own read)
    // always runs first. Firestore transactions retry automatically on a
    // conflicting concurrent write, which is what makes this exactly-once:
    // if two callers race with the same idempotencyKey, only one commits
    // the "create" branch below; the other is transparently re-run by the
    // Admin SDK and, on retry, takes this "already exists" branch instead.
    if (idempotencyRef) {
      const existingKey = await transaction.get(idempotencyRef);
      if (existingKey.exists) {
        const existingOrderId = existingKey.data()!.resultId as string;
        const existingOrderSnap = await transaction.get(orderDoc(companyId, existingOrderId));
        if (existingOrderSnap.exists) {
          return toOrder(existingOrderSnap.id, existingOrderSnap.data()!);
        }
      }
    }

    transaction.set(orderRef, {
      branchId: input.branchId,
      appId: input.appId,
      status: "pending",
      ...(input.customerRef ? { customerRef: input.customerRef } : {}),
      totals,
      createdBy: session.uid,
      createdAt: now,
      updatedAt: now,
    });

    input.lines.forEach((line, index) => {
      const lineRef = linesCollection(companyId, orderRef.id).doc();
      transaction.set(lineRef, {
        branchId: input.branchId,
        itemId: line.itemId,
        itemNameSnapshot: line.itemNameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: lineTotals[index],
      });
    });

    if (idempotencyRef) {
      transaction.set(idempotencyRef, {
        operation: "createOrder",
        resultId: orderRef.id,
        createdAt: now,
      });
    }

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: "order.created",
      targetType: "order",
      targetId: orderRef.id,
      branchId: input.branchId,
      after: { status: "pending", total: totals.total },
    });

    return {
      id: orderRef.id,
      branchId: input.branchId,
      appId: input.appId,
      status: "pending",
      ...(input.customerRef ? { customerRef: input.customerRef } : {}),
      totals,
      createdBy: session.uid,
    };
  });
}

// Only ever valid on a pending order -- roadmap's "pending-order handling"
// (adding items to a still-open order before it's completed).
export async function addOrderLine(companyId: string, orderId: string, input: OrderLineInput): Promise<void> {
  assertValidLineInput(input);
  const { context, order } = await requireOrderAccess(companyId, orderId, "orders.create");
  if (order.status !== "pending") throw new OrderNotEditableError();

  const orderRef = orderDoc(companyId, orderId);
  const lineRef = linesCollection(companyId, orderId).doc();
  const lineTotal = computeLineTotal(input.quantity, input.unitPrice);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new OrderNotFoundError();
    const currentOrder = toOrder(orderSnap.id, orderSnap.data()!);
    if (currentOrder.status !== "pending") throw new OrderNotEditableError();

    const linesSnap = await transaction.get(linesCollection(companyId, orderId));
    const existingLineTotals = linesSnap.docs.map((doc) => doc.data().lineTotal as number);
    const totals = computeTotals({
      lineTotals: [...existingLineTotals, lineTotal],
      tax: currentOrder.totals.tax,
      discount: currentOrder.totals.discount,
    });

    transaction.set(lineRef, {
      branchId: currentOrder.branchId,
      itemId: input.itemId,
      itemNameSnapshot: input.itemNameSnapshot,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      lineTotal,
    });

    transaction.update(orderRef, { totals, updatedAt: FieldValue.serverTimestamp() });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: context.session.uid,
      action: "order.lineAdded",
      targetType: "order",
      targetId: orderId,
      branchId: currentOrder.branchId,
      before: { total: currentOrder.totals.total },
      after: { total: totals.total },
    });
  });
}

// Same shape as addOrderLine: only valid on a pending order, re-reads
// status and every line's total inside the transaction, recomputes totals
// from scratch rather than patching them incrementally.
export async function updateOrderLineQuantity(
  companyId: string,
  orderId: string,
  lineId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) throw new Error("Quantity must be positive.");
  const { context } = await requireOrderAccess(companyId, orderId, "orders.create");

  const orderRef = orderDoc(companyId, orderId);
  const lineRef = lineDoc(companyId, orderId, lineId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new OrderNotFoundError();
    const currentOrder = toOrder(orderSnap.id, orderSnap.data()!);
    if (currentOrder.status !== "pending") throw new OrderNotEditableError();

    const lineSnap = await transaction.get(lineRef);
    if (!lineSnap.exists) throw new OrderLineNotFoundError();
    const currentLine = toOrderLine(lineSnap.id, lineSnap.data()!);

    const linesSnap = await transaction.get(linesCollection(companyId, orderId));
    const otherLineTotals = linesSnap.docs
      .filter((doc) => doc.id !== lineId)
      .map((doc) => doc.data().lineTotal as number);
    const newLineTotal = computeLineTotal(quantity, currentLine.unitPrice);
    const totals = computeTotals({
      lineTotals: [...otherLineTotals, newLineTotal],
      tax: currentOrder.totals.tax,
      discount: currentOrder.totals.discount,
    });

    transaction.update(lineRef, { quantity, lineTotal: newLineTotal });
    transaction.update(orderRef, { totals, updatedAt: FieldValue.serverTimestamp() });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: context.session.uid,
      action: "order.lineQuantityUpdated",
      targetType: "order",
      targetId: orderId,
      branchId: currentOrder.branchId,
      before: { total: currentOrder.totals.total },
      after: { total: totals.total },
    });
  });
}

// Same shape as updateOrderLineQuantity above, deleting the line instead of
// patching its quantity.
export async function removeOrderLine(companyId: string, orderId: string, lineId: string): Promise<void> {
  const { context } = await requireOrderAccess(companyId, orderId, "orders.create");

  const orderRef = orderDoc(companyId, orderId);
  const lineRef = lineDoc(companyId, orderId, lineId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new OrderNotFoundError();
    const currentOrder = toOrder(orderSnap.id, orderSnap.data()!);
    if (currentOrder.status !== "pending") throw new OrderNotEditableError();

    const lineSnap = await transaction.get(lineRef);
    if (!lineSnap.exists) throw new OrderLineNotFoundError();

    const linesSnap = await transaction.get(linesCollection(companyId, orderId));
    const remainingLineTotals = linesSnap.docs
      .filter((doc) => doc.id !== lineId)
      .map((doc) => doc.data().lineTotal as number);
    const totals = computeTotals({
      lineTotals: remainingLineTotals,
      tax: currentOrder.totals.tax,
      discount: currentOrder.totals.discount,
    });

    transaction.delete(lineRef);
    transaction.update(orderRef, { totals, updatedAt: FieldValue.serverTimestamp() });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: context.session.uid,
      action: "order.lineRemoved",
      targetType: "order",
      targetId: orderId,
      branchId: currentOrder.branchId,
      before: { total: currentOrder.totals.total },
      after: { total: totals.total },
    });
  });
}

// Deducts stock for every line and completes the order in one transaction.
// Re-reads the order's status inside the transaction (the idempotency
// guard): retrying an already-completed order throws
// InvalidOrderTransitionError instead of deducting stock a second time. If
// any line has insufficient stock, the whole transaction aborts -- no
// partial fulfillment, no partial stock change (planStockChange() throws
// before any commitStockChangePlan() has run for *any* line).
export async function completeOrder(companyId: string, orderId: string): Promise<void> {
  const { context } = await requireOrderAccess(companyId, orderId, "orders.complete");

  const orderRef = orderDoc(companyId, orderId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new OrderNotFoundError();
    const currentOrder = toOrder(orderSnap.id, orderSnap.data()!);

    if (!canTransition(currentOrder.status, "completed")) {
      throw new InvalidOrderTransitionError(currentOrder.status, "completed");
    }

    const linesSnap = await transaction.get(linesCollection(companyId, orderId));
    const lines = linesSnap.docs.map((doc) => toOrderLine(doc.id, doc.data()));

    // All reads (including every line's item/stock lookup inside
    // planStockChange) must finish before any writes -- so every line is
    // planned first, then every plan is committed, never interleaved.
    const plans: StockChangePlan[] = [];
    for (const line of lines) {
      const plan = await planStockChange(transaction, {
        companyId,
        branchId: currentOrder.branchId,
        itemId: line.itemId,
        type: "sale",
        reason: "order-completed",
        performedBy: context.session.uid,
        computeDelta: () => -line.quantity,
      });
      if (plan) plans.push(plan);
    }

    for (const plan of plans) {
      commitStockChangePlan(transaction, plan);
    }

    transaction.update(orderRef, { status: "completed", updatedAt: FieldValue.serverTimestamp() });

    // In addition to the per-line stock audit entries commitStockChangePlan()
    // already wrote above, one entry for the order's own status change.
    writeAuditInTransaction(transaction, {
      companyId,
      actorId: context.session.uid,
      action: "order.completed",
      targetType: "order",
      targetId: orderId,
      branchId: currentOrder.branchId,
      before: { status: currentOrder.status },
      after: { status: "completed" },
    });
  });
}

// pending -> voided has no stock effect (nothing was ever deducted).
// completed -> voided reverses exactly what completeOrder() deducted, in
// the same transaction as the status change. Re-checks canTransition()
// inside the transaction for the same idempotency reason as completeOrder.
export async function voidOrder(companyId: string, orderId: string): Promise<void> {
  const { context } = await requireOrderAccess(companyId, orderId, "orders.void");

  const orderRef = orderDoc(companyId, orderId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new OrderNotFoundError();
    const currentOrder = toOrder(orderSnap.id, orderSnap.data()!);

    if (!canTransition(currentOrder.status, "voided")) {
      throw new InvalidOrderTransitionError(currentOrder.status, "voided");
    }

    if (currentOrder.status === "completed") {
      const linesSnap = await transaction.get(linesCollection(companyId, orderId));
      const lines = linesSnap.docs.map((doc) => toOrderLine(doc.id, doc.data()));

      const plans: StockChangePlan[] = [];
      for (const line of lines) {
        const plan = await planStockChange(transaction, {
          companyId,
          branchId: currentOrder.branchId,
          itemId: line.itemId,
          type: "sale",
          reason: "order-voided",
          performedBy: context.session.uid,
          computeDelta: () => line.quantity,
        });
        if (plan) plans.push(plan);
      }

      for (const plan of plans) {
        commitStockChangePlan(transaction, plan);
      }
    }

    transaction.update(orderRef, { status: "voided", updatedAt: FieldValue.serverTimestamp() });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: context.session.uid,
      action: "order.voided",
      targetType: "order",
      targetId: orderId,
      branchId: currentOrder.branchId,
      before: { status: currentOrder.status },
      after: { status: "voided" },
    });
  });
}

export async function getOrder(companyId: string, orderId: string): Promise<Order | null> {
  const snap = await orderDoc(companyId, orderId).get();
  if (!snap.exists) return null;
  const order = toOrder(snap.id, snap.data()!);
  await assertBranchAccess(companyId, "orders.view", order.branchId);
  return order;
}

export async function listOrdersForBranch(companyId: string, branchId: string): Promise<Order[]> {
  await assertBranchAccess(companyId, "orders.view", branchId);
  const snap = await ordersCollection(companyId).where("branchId", "==", branchId).get();
  return snap.docs.map((doc) => toOrder(doc.id, doc.data()));
}

export async function listOrderLines(companyId: string, orderId: string): Promise<OrderLine[]> {
  await requireOrderAccess(companyId, orderId, "orders.view");
  const linesSnap = await linesCollection(companyId, orderId).get();
  return linesSnap.docs.map((doc) => toOrderLine(doc.id, doc.data()));
}
