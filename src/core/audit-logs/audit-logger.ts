import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { requireCapability } from "@/core/roles-permissions";

import type { AuditAction, AuditLogEntry, AuditTargetType } from "./audit-log.types";

function auditLogsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("auditLogs");
}

export type AuditLogParams = {
  companyId: string;
  actorId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  branchId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

// The single write-through logging call every mutation path in Core calls
// (ARCHITECTURE.md §4) -- takes an already-open Transaction so the log
// entry commits atomically with the mutation it records, in the very same
// transaction, never as a separate best-effort write. No capability check
// here: this is an internal recording primitive, not a read/write entry
// point of its own -- the caller's own guard (inventory.write,
// orders.complete, etc.) is what authorized the mutation being logged.
export function writeAuditInTransaction(transaction: Transaction, params: AuditLogParams): void {
  const { companyId, ...entry } = params;
  const ref = auditLogsCollection(companyId).doc();
  transaction.set(ref, {
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function toAuditLogEntry(id: string, data: DocumentData): AuditLogEntry {
  return {
    id,
    actorId: data.actorId,
    action: data.action,
    targetType: data.targetType,
    targetId: data.targetId,
    branchId: data.branchId,
    before: data.before,
    after: data.after,
  };
}

// The one read entry point -- gated by audit.view (Owner/Manager only),
// unlike the write side, which has no capability of its own since it's
// never called directly by a client action.
export async function listAuditLogs(companyId: string): Promise<AuditLogEntry[]> {
  await requireCapability(companyId, "audit.view");
  const snap = await auditLogsCollection(companyId).get();
  return snap.docs.map((doc) => toAuditLogEntry(doc.id, doc.data()));
}
