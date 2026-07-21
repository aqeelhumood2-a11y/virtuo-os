import "server-only";

import {
  addOrderLine,
  completeOrder,
  createNotification,
  createOrder,
  getOrder,
  listCompanyMembers,
  listOrderLines,
  listOrdersForBranch,
  removeOrderLine,
  updateOrderLineQuantity,
  voidOrder,
} from "@/core";
import type { Order, OrderLine, OrderLineInput } from "@/core";

import type { CreateSaleParams } from "../domain/sale.types";

async function otherAdminUids(companyId: string, actorId: string): Promise<string[]> {
  const members = await listCompanyMembers(companyId);
  return members
    .filter((member) => (member.role === "Owner" || member.role === "Manager") && member.uid !== actorId)
    .map((member) => member.uid);
}

// The single entry point for "check out a built cart." draftId is a
// client-generated key, minted once per logical checkout action and
// reused across any retry of that same submission (double-click, network
// retry) -- Core's createOrder idempotency guarantee (Phase 3), reused
// as-is here, is what prevents a duplicate sale under concurrency. Unlike
// Restaurant's createTicket, there is no second write to make atomic with
// Core's: Retail has no App-owned data at all, so this is complete the
// moment createOrder returns -- no repair path, no App-owned audit action,
// because there is nothing here for a prior attempt to have left half-done.
export async function createSale(companyId: string, params: CreateSaleParams): Promise<Order> {
  return createOrder(
    companyId,
    { branchId: params.branchId, appId: "retail", lines: params.lines },
    { idempotencyKey: params.draftId },
  );
}

export async function addLine(companyId: string, orderId: string, input: OrderLineInput): Promise<void> {
  await addOrderLine(companyId, orderId, input);
}

export async function updateLineQuantity(
  companyId: string,
  orderId: string,
  lineId: string,
  quantity: number,
): Promise<void> {
  await updateOrderLineQuantity(companyId, orderId, lineId, quantity);
}

export async function removeLine(companyId: string, orderId: string, lineId: string): Promise<void> {
  await removeOrderLine(companyId, orderId, lineId);
}

export async function completeSale(companyId: string, orderId: string): Promise<void> {
  await completeOrder(companyId, orderId);
}

// Notifies other Owners/Managers of the void (never the actor) -- the same
// pattern Restaurant's voidTicket uses, reused here since it's a direct
// structural mirror of the same Core operation, not a new mechanism.
export async function voidSale(companyId: string, orderId: string, actorId: string): Promise<void> {
  await voidOrder(companyId, orderId);

  const recipients = await otherAdminUids(companyId, actorId);
  await Promise.all(
    recipients.map((uid) =>
      createNotification(uid, {
        title: "Sale voided",
        body: `Sale ${orderId} was voided.`,
        relatedEntity: { type: "order", id: orderId },
      }),
    ),
  );
}

export type SaleDetail = { order: Order; lines: OrderLine[] };

export async function getSaleDetail(companyId: string, orderId: string): Promise<SaleDetail | null> {
  const order = await getOrder(companyId, orderId);
  if (!order) return null;
  const lines = await listOrderLines(companyId, orderId);
  return { order, lines };
}

// Backed directly by Core's own listOrdersForBranch -- no App-owned
// collection to join against, unlike Restaurant's listOrderHistory (which
// needs its own orderMeta). Per-branch, matching Core's own branch-scoped
// authorization for this query.
export async function listSaleHistory(companyId: string, branchId: string): Promise<Order[]> {
  return listOrdersForBranch(companyId, branchId);
}

export async function listPendingSales(companyId: string, branchId: string): Promise<Order[]> {
  const orders = await listSaleHistory(companyId, branchId);
  return orders.filter((order) => order.status === "pending");
}
