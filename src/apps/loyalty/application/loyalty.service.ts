import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { BranchAccessDeniedError, getOrder, listAuditLogsPage, writeAuditInTransaction } from "@/core";
import type { AuditLogEntry } from "@/core";

import type { LoyaltyAuditAction } from "../domain/loyalty-audit.types";
import { MemberNotFoundError, OrderAlreadyAttributedError, OrderNotFoundError } from "../domain/errors";
import type { LoyaltyLedgerEntry, LoyaltyMember } from "../domain/loyalty.types";

import {
  adjustMemberBalanceInTransaction,
  createMemberInTransaction,
  getMember,
  listMembers,
  newMemberRef,
} from "./member.repository";
import { appendLedgerEntryInTransaction, getLedgerEntryByOrderId, listLedgerForMember } from "./ledger.repository";
import { attributionDoc, getAttribution, setAttributionInTransaction } from "./attribution.repository";
import { getSyncCursorId, setSyncCursorId } from "./sync-cursor.repository";

// Simple, fixed ratio for this phase -- not a per-company setting yet (no
// UI/data model for that exists; would be a small, separate addition, not
// assumed here). 1 point per $1 of an order's total.
const POINTS_PER_CURRENCY_UNIT = 1;
const SYNC_PAGE_SIZE = 100;

export async function enrollMember(
  companyId: string,
  actorId: string,
  input: { name: string; contactRef: string | null },
): Promise<LoyaltyMember> {
  const ref = newMemberRef(companyId);

  await adminDb.runTransaction(async (transaction) => {
    createMemberInTransaction(transaction, ref, input);
    writeAuditInTransaction<LoyaltyAuditAction, "loyaltyMember">(transaction, {
      companyId,
      actorId,
      action: "loyalty.memberEnrolled",
      targetType: "loyaltyMember",
      targetId: ref.id,
      after: { name: input.name },
    });
  });

  return { id: ref.id, name: input.name, contactRef: input.contactRef, pointsBalance: 0 };
}

export async function getMemberBalance(companyId: string, memberId: string): Promise<LoyaltyMember | null> {
  return getMember(companyId, memberId);
}

export async function listAllMembers(companyId: string): Promise<LoyaltyMember[]> {
  return listMembers(companyId);
}

export async function listLedgerEntriesForMember(companyId: string, memberId: string): Promise<LoyaltyLedgerEntry[]> {
  return listLedgerForMember(companyId, memberId);
}

// The manual linking step recommended in the Phase 4.2 proposal §13.2 --
// deliberately decoupled from Restaurant's/Retail's own checkout flows
// (neither is touched, neither knows Loyalty exists). Validates the order
// is real via Core's own getOrder (a read, not a modification), which also
// naturally enforces that the attributing staff member has orders.view
// access to that order's branch.
export async function attributeOrderToMember(
  companyId: string,
  orderId: string,
  memberId: string,
  actorId: string,
): Promise<void> {
  const [order, member] = await Promise.all([getOrder(companyId, orderId), getMember(companyId, memberId)]);
  if (!order) throw new OrderNotFoundError();
  if (!member) throw new MemberNotFoundError();

  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(attributionDoc(companyId, orderId));
    if (existing.exists) {
      // Same order, same member: an idempotent retry, not an error.
      if (existing.data()!.memberId === memberId) return;
      throw new OrderAlreadyAttributedError();
    }
    setAttributionInTransaction(transaction, companyId, orderId, memberId, actorId);
  });
}

export type SyncAccrualsResult = {
  processedCount: number;
  accruedCount: number;
  skippedCount: number;
};

// The accrual engine, triggered lazily (on Loyalty app mount, or via an
// explicit "Sync Now" action -- see actions.ts/routes/LoyaltyAppRoot.tsx),
// never by any new event/scheduler infrastructure, per the approved
// Phase 4.2 design.
//
// Reads Core's own audit log (listAuditLogsPage, unchanged, Phase 1G) for
// order.completed entries newer than the last-processed cursor. Core's own
// pagination is newest-first, so this walks backward page by page until it
// either finds the stored cursor or exhausts the log (first run), then
// processes the newly-found entries oldest-first.
//
// Known, deliberate limitation (documented, not hidden): the cursor always
// advances past every order.completed entry it examines, whether or not
// that order has an attribution yet. An order not yet attributed by the
// time sync next runs will not be revisited by a later sync -- its accrual
// window is closed, not retried indefinitely. This keeps the cursor
// monotonic (bounded scan cost, no unbounded re-scanning, and no risk of
// one perpetually-unattributed order blocking every later order's
// accrual). Staff must attribute an order before the next sync run for it
// to accrue automatically.
export async function syncAccruals(companyId: string): Promise<SyncAccrualsResult> {
  const cursorId = await getSyncCursorId(companyId);

  const newEntries: AuditLogEntry[] = [];
  let pageCursor: string | undefined;
  let reachedBoundary = false;

  do {
    const page = await listAuditLogsPage(companyId, { cursor: pageCursor, limit: SYNC_PAGE_SIZE });
    if (page.items.length === 0) break;

    for (const entry of page.items) {
      if (cursorId && entry.id === cursorId) {
        reachedBoundary = true;
        break;
      }
      if (entry.action === "order.completed") newEntries.push(entry);
    }

    pageCursor = page.nextCursor ?? undefined;
  } while (!reachedBoundary && pageCursor);

  // Collected newest-first (matching listAuditLogsPage); process oldest
  // first so the ledger and the cursor advance in chronological order.
  newEntries.reverse();

  let processedCount = 0;
  let accruedCount = 0;
  let skippedCount = 0;
  let newestSeenId = cursorId;

  for (const entry of newEntries) {
    processedCount += 1;
    newestSeenId = entry.id;

    const orderId = entry.targetId;

    const attribution = await getAttribution(companyId, orderId);
    if (!attribution) {
      skippedCount += 1;
      continue;
    }

    // Defensive idempotency guard: normally unreachable given the cursor
    // only ever advances past an entry once, but protects against a crash
    // between a prior run's ledger write and its own cursor advance (see
    // sync-cursor.repository.ts's header comment).
    const existingEntry = await getLedgerEntryByOrderId(companyId, orderId);
    if (existingEntry) continue;

    let order;
    try {
      order = await getOrder(companyId, orderId);
    } catch (error) {
      // A branch-scoped actor triggering sync may lack access to some
      // orders' branches (Core's own getOrder enforces this) -- skip
      // rather than aborting the whole run. Learned from the pre-existing
      // Restaurant listOrderHistory gap (tracked as issue #2): that
      // function lets exactly this error abort an entire list instead of
      // filtering, which is not repeated here.
      if (error instanceof BranchAccessDeniedError) {
        skippedCount += 1;
        continue;
      }
      throw error;
    }
    if (!order) {
      skippedCount += 1;
      continue;
    }

    const points = Math.floor(order.totals.total * POINTS_PER_CURRENCY_UNIT);
    if (points > 0) {
      await adminDb.runTransaction(async (transaction) => {
        appendLedgerEntryInTransaction(transaction, companyId, {
          memberId: attribution.memberId,
          type: "earned",
          points,
          orderId,
          reason: null,
          actorId: attribution.attributedBy,
        });
        adjustMemberBalanceInTransaction(transaction, companyId, attribution.memberId, points);
        writeAuditInTransaction<LoyaltyAuditAction, "loyaltyLedgerEntry">(transaction, {
          companyId,
          actorId: attribution.attributedBy,
          action: "loyalty.pointsEarned",
          targetType: "loyaltyLedgerEntry",
          targetId: orderId,
          branchId: order.branchId,
          after: { points, memberId: attribution.memberId },
        });
      });
      accruedCount += 1;
    }
  }

  if (newestSeenId && newestSeenId !== cursorId) {
    await setSyncCursorId(companyId, newestSeenId);
  }

  return { processedCount, accruedCount, skippedCount };
}
