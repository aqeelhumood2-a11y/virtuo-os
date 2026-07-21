import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

// companies/{companyId}/connectors/{connectorId}/productMappings/{externalId}
// -- Platform-owned, not an App's. Keyed by the external system's own
// product/variant id, the same "key by the thing that must be unique"
// idempotency pattern Loyalty's attributions/{orderId} established: a
// second sync for a product already mapped updates the same doc rather
// than creating a duplicate Core Inventory Item. See
// docs/phases/PHASE_5_PLAN.md §6.
export type ProductMapping = {
  externalId: string;
  itemId: string; // Core's own InventoryItem id
  externalQuantity?: number; // reported stock level, informational only -- see PHASE_5_PLAN.md §6
  lastSyncedAt: string; // ISO -- the sync run's own syncedAt, not a Firestore Timestamp
};

function productMappingsCollection(companyId: string, connectorId: string) {
  return adminDb.collection("companies").doc(companyId).collection("connectors").doc(connectorId).collection("productMappings");
}

export function productMappingDoc(companyId: string, connectorId: string, externalId: string) {
  return productMappingsCollection(companyId, connectorId).doc(externalId);
}

function toProductMapping(externalId: string, data: DocumentData): ProductMapping {
  return {
    externalId,
    itemId: data.itemId,
    externalQuantity: data.externalQuantity ?? undefined,
    lastSyncedAt: data.lastSyncedAt,
  };
}

export async function getProductMapping(companyId: string, connectorId: string, externalId: string): Promise<ProductMapping | null> {
  const snap = await productMappingDoc(companyId, connectorId, externalId).get();
  if (!snap.exists) return null;
  return toProductMapping(snap.id, snap.data()!);
}

export async function listProductMappings(companyId: string, connectorId: string): Promise<ProductMapping[]> {
  const snap = await productMappingsCollection(companyId, connectorId).get();
  return snap.docs.map((doc) => toProductMapping(doc.id, doc.data()));
}

export async function setProductMapping(
  companyId: string,
  connectorId: string,
  externalId: string,
  itemId: string,
  externalQuantity: number | undefined,
  lastSyncedAt: string,
): Promise<void> {
  await productMappingDoc(companyId, connectorId, externalId).set(
    { itemId, externalQuantity: externalQuantity ?? null, lastSyncedAt },
    { merge: true },
  );
}
