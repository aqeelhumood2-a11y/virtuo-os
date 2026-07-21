import "server-only";

import type { Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import {
  addOrderLine,
  completeOrder,
  createNotification,
  createOrder,
  getOrder,
  listCompanyMembers,
  listOrderLines,
  removeOrderLine,
  updateOrderLineQuantity,
  voidOrder,
  writeAuditInTransaction,
} from "@/core";
import type { Order, OrderLine, OrderLineInput } from "@/core";

import type { CreateTicketParams, RestaurantOrderMeta } from "../domain/order-meta.types";
import type { RestaurantAuditAction } from "../domain/restaurant-audit.types";

import {
  getOrderMeta,
  getOrderMetaByOrderId,
  listRecentOrderMeta,
  orderMetaDoc,
  setOrderMetaInTransaction,
} from "./order-meta.repository";

export type Ticket = { order: Order; meta: RestaurantOrderMeta };

async function otherAdminUids(companyId: string, actorId: string): Promise<string[]> {
  const members = await listCompanyMembers(companyId);
  return members
    .filter((member) => (member.role === "Owner" || member.role === "Manager") && member.uid !== actorId)
    .map((member) => member.uid);
}

// The single entry point for "start (or resume submitting) an order" --
// also the deterministic repair path (see the Phase 3 plan's idempotency
// and consistency model). draftId is a client-generated key: the client
// mints it once per logical "start order" action and resubmits the same
// value on any retry (double-click, network retry), so createOrder's own
// idempotency guarantee (never this function's own logic) is what prevents
// a duplicate Core order under concurrency.
export async function createTicket(companyId: string, params: CreateTicketParams): Promise<Ticket> {
  // Idempotent short-circuit: if a previous call already finished both
  // writes (Core's order + this App's own metadata), there is nothing left
  // to do -- no second Core call, no second write.
  const existingMeta = await getOrderMeta(companyId, params.draftId);
  if (existingMeta) {
    const order = await getOrder(companyId, existingMeta.orderId);
    if (order) return { order, meta: existingMeta };
  }

  const order = await createOrder(
    companyId,
    { branchId: params.branchId, appId: "restaurant", lines: params.lines },
    { idempotencyKey: params.draftId },
  );

  // A freshly created order is always "pending" -- createOrder never
  // returns any other status for a brand-new order. If this order's status
  // is anything else, createOrder must have returned a *pre-existing*
  // order for this exact draftId (its own idempotency hit), meaning an
  // earlier attempt already created it and got at least as far as
  // completing/voiding it, but this exact metadata write never landed.
  // That is a deterministic, checkable signal -- not a guess -- so it is
  // the only case that fires the repair audit event.
  const isRepair = order.status !== "pending";

  const orderMetaInput = {
    orderId: order.id,
    branchId: params.branchId,
    orderType: params.orderType,
    tableRef: params.tableRef ?? null,
    guestCount: params.guestCount ?? null,
    kitchenNote: params.kitchenNote ?? null,
  };

  // The transaction callback below must stay side-effect-free beyond its
  // own reads/writes -- Firestore may re-invoke it on a conflicting-write
  // retry, and createNotification isn't part of the transaction's own
  // atomicity, so it's fired only after the transaction has actually
  // committed, and only when this call is the one that performed the write
  // (wasWritten), never on every retry of the callback itself.
  const wasWritten = await adminDb.runTransaction(async (transaction: Transaction) => {
    // Re-check inside the transaction: two concurrent createTicket calls
    // for the same draftId can both pass the plain read above before
    // either writes -- this guards that race the same way createOrder's
    // own idempotency check guards Core's order creation.
    const snap = await transaction.get(orderMetaDoc(companyId, params.draftId));
    if (snap.exists) return false;

    setOrderMetaInTransaction(transaction, companyId, params.draftId, orderMetaInput);

    if (isRepair) {
      writeAuditInTransaction<RestaurantAuditAction, "restaurantOrderMeta">(transaction, {
        companyId,
        actorId: order.createdBy,
        action: "restaurant.orderMetaRepaired",
        targetType: "restaurantOrderMeta",
        targetId: params.draftId,
        branchId: params.branchId,
        after: { orderId: order.id },
      });
    }

    return true;
  });

  if (isRepair && wasWritten) {
    const actorRecipients = await otherAdminUids(companyId, order.createdBy);
    await Promise.all(
      actorRecipients.map((uid) =>
        createNotification(uid, {
          title: "Order metadata repaired",
          body: `A previous attempt to record order ${order.id} didn't finish; its details have now been recovered.`,
          relatedEntity: { type: "order", id: order.id },
        }),
      ),
    );
  }

  const meta: RestaurantOrderMeta = {
    draftId: params.draftId,
    ...orderMetaInput,
    status: "confirmed",
  };

  return { order, meta };
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

export async function completeTicket(companyId: string, orderId: string): Promise<void> {
  await completeOrder(companyId, orderId);
}

export type TicketDetail = { order: Order; lines: OrderLine[]; meta: RestaurantOrderMeta | null };

// Meta lookup is by orderId here (see order-meta.repository's
// getOrderMetaByOrderId) since the ticket-detail route only has Core's own
// orderId from the URL, never the draftId that keys the metadata
// collection. A null meta is possible but not blocking: Core's order
// remains fully readable and actionable on its own (Core is always
// authoritative for lines/totals/status) even if its metadata write is
// still outstanding.
export async function getTicketDetail(companyId: string, orderId: string): Promise<TicketDetail | null> {
  const order = await getOrder(companyId, orderId);
  if (!order) return null;

  const [lines, meta] = await Promise.all([
    listOrderLines(companyId, orderId),
    getOrderMetaByOrderId(companyId, orderId),
  ]);

  return { order, lines, meta };
}

// Abandoning a pending ticket is voiding it -- no separate Restaurant-owned
// "abandoned" state is invented (see the Phase 3 plan's order lifecycle).
// Notifies other Owners/Managers of the void -- the one routine
// notification this App sends (never on ordinary completion). Sent as a
// plain, non-transactional notification: unlike createTicket's repair
// path, void doesn't write any Restaurant-owned document to piggyback the
// notification on, since orderMeta's fields don't change on void.
export async function voidTicket(companyId: string, orderId: string, actorId: string): Promise<void> {
  await voidOrder(companyId, orderId);

  const recipients = await otherAdminUids(companyId, actorId);
  await Promise.all(
    recipients.map((uid) =>
      createNotification(uid, {
        title: "Order voided",
        body: `Order ${orderId} was voided.`,
        relatedEntity: { type: "order", id: orderId },
      }),
    ),
  );
}

const RECENT_HISTORY_LIMIT = 50;

export async function listOrderHistory(companyId: string): Promise<Ticket[]> {
  const metas = await listRecentOrderMeta(companyId, RECENT_HISTORY_LIMIT);
  const tickets = await Promise.all(
    metas.map(async (meta) => {
      const order = await getOrder(companyId, meta.orderId);
      return order ? { order, meta } : null;
    }),
  );
  return tickets.filter((ticket): ticket is Ticket => ticket !== null);
}

export async function resumePendingTickets(companyId: string): Promise<Ticket[]> {
  const history = await listOrderHistory(companyId);
  return history.filter((ticket) => ticket.order.status === "pending");
}
