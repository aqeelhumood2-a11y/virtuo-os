import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { LedgerEntryType, LoyaltyLedgerEntry } from "../domain/loyalty.types";

function ledgerCollection(companyId: string) {
  return adminDb
    .collection("companies")
    .doc(companyId)
    .collection("apps")
    .doc("loyalty")
    .collection("ledger");
}

function toLedgerEntry(id: string, data: DocumentData): LoyaltyLedgerEntry {
  return {
    id,
    memberId: data.memberId,
    type: data.type,
    points: data.points,
    orderId: data.orderId ?? null,
    reason: data.reason ?? null,
    actorId: data.actorId,
  };
}

// The idempotency guard syncAccruals relies on: an orderId can appear in at
// most one "earned" ledger entry, ever. A single-field equality filter
// needs no composite index.
export async function getLedgerEntryByOrderId(
  companyId: string,
  orderId: string,
): Promise<LoyaltyLedgerEntry | null> {
  const snap = await ledgerCollection(companyId).where("orderId", "==", orderId).limit(1).get();
  if (snap.empty) return null;
  return toLedgerEntry(snap.docs[0].id, snap.docs[0].data());
}

export async function listLedgerForMember(companyId: string, memberId: string): Promise<LoyaltyLedgerEntry[]> {
  const snap = await ledgerCollection(companyId)
    .where("memberId", "==", memberId)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs.map((doc) => toLedgerEntry(doc.id, doc.data()));
}

export type AppendLedgerEntryInput = {
  memberId: string;
  type: LedgerEntryType;
  points: number;
  orderId: string | null;
  reason: string | null;
  actorId: string;
};

// Append-only, mirroring inventoryMovements/auditLogs -- never mutated or
// deleted. Always called alongside adjustMemberBalanceInTransaction in the
// same transaction (see loyalty.service.ts), the same "ledger entry +
// denormalized balance together" shape Core's own stock/inventoryMovements
// pair already established.
export function appendLedgerEntryInTransaction(
  transaction: Transaction,
  companyId: string,
  input: AppendLedgerEntryInput,
): void {
  const ref = ledgerCollection(companyId).doc();
  transaction.set(ref, { ...input, createdAt: FieldValue.serverTimestamp() });
}
