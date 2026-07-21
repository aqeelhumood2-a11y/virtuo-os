import "server-only";

import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { applyCursor, DEFAULT_PAGE_SIZE } from "@/lib/firebase/pagination";
import { requireCapability } from "@/core/roles-permissions";
import type { Page, PageOptions } from "@/shared/types";

import type { AuditAction, AuditLogEntry, AuditTargetType } from "./audit-log.types";

function auditLogsCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("auditLogs");
}

export type AuditLogParams<
  TAction extends string = AuditAction,
  TTargetType extends string = AuditTargetType,
> = {
  companyId: string;
  actorId: string;
  action: TAction;
  targetType: TTargetType;
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
//
// Generic over the action/targetType literal types (Phase 2), defaulting
// to Core's own closed AuditAction/AuditTargetType unions -- every existing
// Core call site is unaffected, since none supplies an explicit type
// argument. This lets Platform (which owns its own closed action/target
// vocabulary, e.g. AppInstallAuditAction, and which Core must never import
// -- see docs/phases/PHASE_2_PLAN.md §2/§5) call this same primitive with
// full compile-time exhaustiveness over its own vocabulary:
// `writeAuditInTransaction<AppInstallAuditAction, "app">(transaction, {...})`
// -- without core/audit-logs ever knowing Platform's action literals exist.
export function writeAuditInTransaction<
  TAction extends string = AuditAction,
  TTargetType extends string = AuditTargetType,
>(transaction: Transaction, params: AuditLogParams<TAction, TTargetType>): void {
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

// The original read entry point -- gated by audit.view (Owner/Manager
// only), unlike the write side, which has no capability of its own since
// it's never called directly by a client action. Unpaginated and
// unordered, kept exactly as-is (existing callers, existing behavior) now
// that listAuditLogsPage() below exists for anything that needs bounded,
// ordered reads -- a full-list read of a single company's log is still a
// reasonable thing to want (e.g. an export), so this isn't deprecated.
export async function listAuditLogs(companyId: string): Promise<AuditLogEntry[]> {
  await requireCapability(companyId, "audit.view");
  const snap = await auditLogsCollection(companyId).get();
  return snap.docs.map((doc) => toAuditLogEntry(doc.id, doc.data()));
}

// The pagination-ready read entry point, added ahead of any real UI so the
// eventual audit-log screen never needs a breaking API change: newest
// first (`createdAt desc`, server-side sort), bounded by `limit` (server-
// side), and cursor-resumable. The cursor is just the last entry's own doc
// ID -- resolved back to a DocumentSnapshot for Query.startAfter(), the
// standard Firestore cursor pattern, so pagination is stable even if two
// entries share a `createdAt` value.
export async function listAuditLogsPage(companyId: string, opts: PageOptions = {}): Promise<Page<AuditLogEntry>> {
  await requireCapability(companyId, "audit.view");
  const limit = opts.limit ?? DEFAULT_PAGE_SIZE;

  const collectionRef = auditLogsCollection(companyId);
  const query = await applyCursor(collectionRef, collectionRef.orderBy("createdAt", "desc").limit(limit), opts.cursor);

  const snap = await query.get();
  const items = snap.docs.map((doc) => toAuditLogEntry(doc.id, doc.data()));
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
  return { items, nextCursor };
}
