import "server-only";

import type { CollectionReference, Query } from "firebase-admin/firestore";

// Reasonable default for any Core module's cursor-paginated list API --
// large enough to rarely need a second round trip for a small dataset,
// small enough that no caller is tempted to fetch "everything" at once as
// a collection grows unbounded over time. Shared so every paginated list
// function in Core (core/audit-logs' listAuditLogsPage,
// core/notifications' listNotificationsPage, and future candidates) agrees
// on one default rather than each picking its own.
export const DEFAULT_PAGE_SIZE = 50;

// The cursor-resolution step every cursor-paginated list function repeats:
// a cursor is always the previous page's last document's own ID, resolved
// back to a DocumentSnapshot here so Query.startAfter() gets what Firestore
// actually wants (a snapshot, not a bare field value) -- the standard,
// tie-stable Firestore pagination pattern. A cursor pointing at a doc that
// no longer exists (e.g. deleted between page reads) is silently ignored
// rather than thrown -- the caller gets an un-cursored page back instead of
// an error over what is, from the caller's perspective, a paging detail.
export async function applyCursor(collectionRef: CollectionReference, query: Query, cursor: string | undefined): Promise<Query> {
  if (!cursor) return query;
  const cursorSnap = await collectionRef.doc(cursor).get();
  return cursorSnap.exists ? query.startAfter(cursorSnap) : query;
}
