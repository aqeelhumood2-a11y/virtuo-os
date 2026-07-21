import "server-only";

import type { DocumentData, Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

// companies/{companyId}/connectors/{connectorId}/outboundOrderMappings/{orderId}
// -- Platform-owned. Keyed by Core's own orderId, doubling as both the
// idempotency guard (an order already mapped is never re-selected for a
// later push) and the race guard: reserveOutboundOrder() uses a
// transactional create-if-absent check so two concurrent "Sync Now"
// clicks can't both push the same order to the external system. See
// docs/phases/PHASE_5_PLAN.md §7.
export type OutboundOrderMappingStatus = "reserved" | "pushed";

export type OutboundOrderMapping = {
  orderId: string;
  status: OutboundOrderMappingStatus;
  externalOrderId?: string;
  reservedAt: string;
  pushedAt?: string;
};

function outboundOrderMappingsCollection(companyId: string, connectorId: string) {
  return adminDb
    .collection("companies")
    .doc(companyId)
    .collection("connectors")
    .doc(connectorId)
    .collection("outboundOrderMappings");
}

export function outboundOrderMappingDoc(companyId: string, connectorId: string, orderId: string) {
  return outboundOrderMappingsCollection(companyId, connectorId).doc(orderId);
}

function toOutboundOrderMapping(orderId: string, data: DocumentData): OutboundOrderMapping {
  return {
    orderId,
    status: data.status,
    externalOrderId: data.externalOrderId ?? undefined,
    reservedAt: data.reservedAt,
    pushedAt: data.pushedAt ?? undefined,
  };
}

export async function getOutboundOrderMapping(companyId: string, connectorId: string, orderId: string): Promise<OutboundOrderMapping | null> {
  const snap = await outboundOrderMappingDoc(companyId, connectorId, orderId).get();
  if (!snap.exists) return null;
  return toOutboundOrderMapping(snap.id, snap.data()!);
}

// Transactional create-if-absent: returns false (no write performed) if
// this order is already reserved or pushed by any run, past or
// concurrent -- the caller must not include it in this sync's batch.
export async function reserveOutboundOrder(companyId: string, connectorId: string, orderId: string, reservedAt: string): Promise<boolean> {
  const ref = outboundOrderMappingDoc(companyId, connectorId, orderId);
  return adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists) return false;
    transaction.set(ref, { status: "reserved", reservedAt });
    return true;
  });
}

export async function finalizePushedOrder(
  companyId: string,
  connectorId: string,
  orderId: string,
  externalOrderId: string,
  pushedAt: string,
): Promise<void> {
  await outboundOrderMappingDoc(companyId, connectorId, orderId).set(
    { status: "pushed", externalOrderId, pushedAt },
    { merge: true },
  );
}

// A reservation the connector ultimately failed to push (e.g. no matching
// product reference) is released, not left dangling -- so a later sync
// retries it instead of silently blocking it forever.
export async function releaseReservation(companyId: string, connectorId: string, orderId: string): Promise<void> {
  await outboundOrderMappingDoc(companyId, connectorId, orderId).delete();
}
