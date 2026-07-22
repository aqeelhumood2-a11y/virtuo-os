import "server-only";

import { FieldValue, type DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { PrepStage, PrepStatus } from "../domain/prep-status.types";

// Nested under the same document Platform's app-install state already owns
// (companies/{companyId}/apps/kitchen-display), same convention every App
// uses. Keyed by Core's own orderId -- one prep-status doc per order, the
// same "key by the thing that must be unique" pattern Restaurant's
// orderMeta and Loyalty's attributions both established.
function prepStatusCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("apps").doc("kitchen-display").collection("prepStatus");
}

export function prepStatusDoc(companyId: string, orderId: string) {
  return prepStatusCollection(companyId).doc(orderId);
}

function toPrepStatus(id: string, data: DocumentData): PrepStatus {
  return { orderId: id, branchId: data.branchId, stage: data.stage as PrepStage, updatedBy: data.updatedBy };
}

export async function getPrepStatus(companyId: string, orderId: string): Promise<PrepStatus | null> {
  const snap = await prepStatusDoc(companyId, orderId).get();
  if (!snap.exists) return null;
  return toPrepStatus(snap.id, snap.data()!);
}

// Single-field equality filter -- no composite index needed, same reasoning
// as every other branch-scoped query in this codebase (docs/DATABASE.md §4).
export async function listPrepStatusForBranch(companyId: string, branchId: string): Promise<PrepStatus[]> {
  const snap = await prepStatusCollection(companyId).where("branchId", "==", branchId).get();
  return snap.docs.map((doc) => toPrepStatus(doc.id, doc.data()));
}

// Idempotent by construction (merge: true, keyed by orderId) -- setting the
// same stage twice (a retried click, two staff tapping at once) is a no-op
// in effect.
export async function setPrepStage(
  companyId: string,
  orderId: string,
  branchId: string,
  stage: PrepStage,
  updatedBy: string,
): Promise<void> {
  await prepStatusDoc(companyId, orderId).set(
    { branchId, stage, updatedBy, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
