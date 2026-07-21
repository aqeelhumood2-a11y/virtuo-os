import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { LoyaltyAttribution } from "../domain/loyalty.types";

function attributionsCollection(companyId: string) {
  return adminDb
    .collection("companies")
    .doc(companyId)
    .collection("apps")
    .doc("loyalty")
    .collection("attributions");
}

// Keyed by Core's own orderId -- the deterministic, exact link between a
// completed order and the member it accrues for, the same "key by the
// thing that must be unique" reasoning Phase 3's orderMeta/draftId keying
// used.
export function attributionDoc(companyId: string, orderId: string) {
  return attributionsCollection(companyId).doc(orderId);
}

function toAttribution(id: string, data: DocumentData): LoyaltyAttribution {
  return { orderId: id, memberId: data.memberId, attributedBy: data.attributedBy };
}

export async function getAttribution(companyId: string, orderId: string): Promise<LoyaltyAttribution | null> {
  const snap = await attributionDoc(companyId, orderId).get();
  if (!snap.exists) return null;
  return toAttribution(snap.id, snap.data()!);
}

export function setAttributionInTransaction(
  transaction: Transaction,
  companyId: string,
  orderId: string,
  memberId: string,
  attributedBy: string,
): void {
  transaction.set(attributionDoc(companyId, orderId), {
    memberId,
    attributedBy,
    createdAt: FieldValue.serverTimestamp(),
  });
}
