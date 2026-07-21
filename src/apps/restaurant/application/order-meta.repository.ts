import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { RestaurantOrderMeta } from "../domain/order-meta.types";

// Nested under the SAME document Platform's app-install state already owns
// (companies/{companyId}/apps/restaurant) -- a Firestore document can carry
// both its own fields (Platform's enabled/installedAt/config) and its own
// subcollections (this App's own data), the App-owned-namespace convention
// documented since Phase 1.
function orderMetaCollection(companyId: string) {
  return adminDb
    .collection("companies")
    .doc(companyId)
    .collection("apps")
    .doc("restaurant")
    .collection("orderMeta");
}

export function orderMetaDoc(companyId: string, draftId: string) {
  return orderMetaCollection(companyId).doc(draftId);
}

function toOrderMeta(id: string, data: DocumentData): RestaurantOrderMeta {
  return {
    draftId: id,
    orderId: data.orderId,
    branchId: data.branchId,
    orderType: data.orderType,
    tableRef: data.tableRef ?? null,
    guestCount: data.guestCount ?? null,
    kitchenNote: data.kitchenNote ?? null,
    status: "confirmed",
  };
}

export async function getOrderMeta(companyId: string, draftId: string): Promise<RestaurantOrderMeta | null> {
  const snap = await orderMetaDoc(companyId, draftId).get();
  if (!snap.exists) return null;
  return toOrderMeta(snap.id, snap.data()!);
}

// A single-field equality filter needs no composite index. Used by the
// ticket-detail route, which only has Core's own orderId (from the URL),
// never the draftId that keys this collection.
export async function getOrderMetaByOrderId(companyId: string, orderId: string): Promise<RestaurantOrderMeta | null> {
  const snap = await orderMetaCollection(companyId).where("orderId", "==", orderId).limit(1).get();
  if (snap.empty) return null;
  return toOrderMeta(snap.docs[0].id, snap.docs[0].data());
}

export type OrderMetaWriteInput = {
  orderId: string;
  branchId: string;
  orderType: RestaurantOrderMeta["orderType"];
  tableRef: string | null;
  guestCount: number | null;
  kitchenNote: string | null;
};

// Idempotent by construction (merge: true, keyed by draftId) -- safe to
// call any number of times with the same draftId and the same input.
export function setOrderMetaInTransaction(
  transaction: Transaction,
  companyId: string,
  draftId: string,
  input: OrderMetaWriteInput,
): void {
  transaction.set(
    orderMetaDoc(companyId, draftId),
    {
      ...input,
      status: "confirmed",
      recordedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// Ordered newest-first -- backs Order History and the "resume pending
// ticket" list (order-ticket.service.ts filters the latter to Core orders
// still in "pending" status).
export async function listRecentOrderMeta(companyId: string, limit: number): Promise<RestaurantOrderMeta[]> {
  const snap = await orderMetaCollection(companyId).orderBy("recordedAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => toOrderMeta(doc.id, doc.data()));
}
