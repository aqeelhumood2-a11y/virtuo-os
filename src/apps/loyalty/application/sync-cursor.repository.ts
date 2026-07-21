import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

// Internal bookkeeping only -- never read by a client, same tier as Core's
// own idempotencyKeys (Phase 3). Tracks how far back into Core's own
// auditLogs syncAccruals has already scanned, purely as a scan-efficiency
// optimization: correctness never depends on this being atomic with
// anything else, since each ledger append is independently idempotency-
// guarded by orderId (see ledger.repository.ts). If a sync run crashes
// after writing some ledger entries but before this is updated, the next
// run safely re-scans and re-skips the same entries rather than
// double-accruing.
function syncCursorDoc(companyId: string) {
  return adminDb
    .collection("companies")
    .doc(companyId)
    .collection("apps")
    .doc("loyalty")
    .collection("syncCursor")
    .doc("default");
}

export async function getSyncCursorId(companyId: string): Promise<string | null> {
  const snap = await syncCursorDoc(companyId).get();
  if (!snap.exists) return null;
  return snap.data()?.lastProcessedLogId ?? null;
}

export async function setSyncCursorId(companyId: string, lastProcessedLogId: string): Promise<void> {
  await syncCursorDoc(companyId).set(
    { lastProcessedLogId, lastSyncedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
