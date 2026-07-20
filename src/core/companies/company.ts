import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction } from "@/core/audit-logs";
import { requireCapability } from "@/core/roles-permissions";

function companyDoc(companyId: string) {
  return adminDb.collection("companies").doc(companyId);
}

// Both of these are the only two mutations 1C's Firestore rules ever
// allowed a direct client write for (1D). Routing them through server code
// instead closes the one gap in "every mutation from 1B-1F is audited" --
// a direct client write has no server-side interception point to log from.
// See docs/phases/PHASE_1G_PLAN.md §2.
export async function updateCompanyName(companyId: string, name: string): Promise<void> {
  const { session } = await requireCapability(companyId, "company.update");
  const ref = companyDoc(companyId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Company not found.");
    const before = snap.data()!;

    transaction.update(ref, { name, updatedAt: FieldValue.serverTimestamp() });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: "company.updated",
      targetType: "company",
      targetId: companyId,
      before: { name: before.name },
      after: { name },
    });
  });
}

export async function setCompanyStatus(companyId: string, status: "active" | "suspended"): Promise<void> {
  const { session } = await requireCapability(companyId, "company.suspend");
  const ref = companyDoc(companyId);

  await adminDb.runTransaction(async (transaction: Transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Company not found.");
    const before = snap.data()!;

    transaction.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });

    writeAuditInTransaction(transaction, {
      companyId,
      actorId: session.uid,
      action: status === "suspended" ? "company.suspended" : "company.reactivated",
      targetType: "company",
      targetId: companyId,
      before: { status: before.status },
      after: { status },
    });
  });
}
