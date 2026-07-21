import "server-only";

import { FieldValue, type DocumentData, type DocumentReference, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { LoyaltyMember } from "../domain/loyalty.types";

// Nested under the same document Platform's install-state already owns for
// this App (companies/{companyId}/apps/loyalty) -- the same App-owned-
// namespace convention Restaurant and Retail already established.
function membersCollection(companyId: string) {
  return adminDb
    .collection("companies")
    .doc(companyId)
    .collection("apps")
    .doc("loyalty")
    .collection("members");
}

export function memberDoc(companyId: string, memberId: string) {
  return membersCollection(companyId).doc(memberId);
}

export function newMemberRef(companyId: string): DocumentReference {
  return membersCollection(companyId).doc();
}

function toMember(id: string, data: DocumentData): LoyaltyMember {
  return {
    id,
    name: data.name,
    contactRef: data.contactRef ?? null,
    pointsBalance: data.pointsBalance ?? 0,
  };
}

export async function getMember(companyId: string, memberId: string): Promise<LoyaltyMember | null> {
  const snap = await memberDoc(companyId, memberId).get();
  if (!snap.exists) return null;
  return toMember(snap.id, snap.data()!);
}

export async function listMembers(companyId: string): Promise<LoyaltyMember[]> {
  const snap = await membersCollection(companyId).get();
  return snap.docs.map((doc) => toMember(doc.id, doc.data()));
}

export type CreateMemberInput = { name: string; contactRef: string | null };

// Ref is created outside the transaction (an auto-ID doc() call touches no
// network) and set inside it, the same shape Core's own createOrder uses.
export function createMemberInTransaction(
  transaction: Transaction,
  ref: DocumentReference,
  input: CreateMemberInput,
): void {
  transaction.set(ref, {
    name: input.name,
    contactRef: input.contactRef,
    pointsBalance: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// FieldValue.increment() makes this atomic without needing to read the
// current balance first inside the transaction -- simpler and safer than
// Core's own read-then-write balance pattern would require here, since
// Firestore provides this primitive directly.
export function adjustMemberBalanceInTransaction(
  transaction: Transaction,
  companyId: string,
  memberId: string,
  delta: number,
): void {
  transaction.update(memberDoc(companyId, memberId), { pointsBalance: FieldValue.increment(delta) });
}
