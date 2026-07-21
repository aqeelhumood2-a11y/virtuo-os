# Phase 1G Hardening — Audit Action Maintainability, Pagination, and Batch Safety

Status: **approved, implemented.**

Requested before Phase 1G's final approval, as technical-debt cleanup: eliminate manual `AuditAction` maintenance, prepare Audit Logs and Notifications for a future UI (pagination), remove `markAllAsRead`'s 500-op batch ceiling, and a general Core cleanup pass. All four keep existing public APIs and behavior unchanged — every change here is additive or an internal refactor, never a breaking one.

## 1. Decentralized `AuditAction`

**Problem:** `core/audit-logs/audit-log.types.ts` previously hand-maintained one flat `AuditAction` union covering every mutation across `companies`/`inventory-engine`/`order-engine`. Adding a new mutation meant editing a file in a module unrelated to the one actually being worked on, with nothing enforcing that the union and the call sites calling `writeAuditInTransaction` ever agreed.

**Fix:** Each domain module now owns its own action vocabulary, colocated with the enum/union that already drives it — the same place a developer working on that module is already looking:
- `CompanyAuditAction` / `MembershipAuditAction` — `core/companies/types.ts`, next to `Company`/`Membership`.
- `InventoryAuditAction` — `core/inventory-engine/domain/types.ts`, next to `MovementType`.
- `OrderAuditAction` — `core/order-engine/domain/types.ts`, next to `OrderStatus`.

`core/audit-logs/audit-log.types.ts` now only unions them: `type AuditAction = CompanyAuditAction | MembershipAuditAction | InventoryAuditAction | OrderAuditAction`. A new mutation's action literal is added to the owning module's own type — `core/audit-logs` is never touched for it. The exported `AuditAction` type (and every stored string value) is unchanged, so every existing call site and every stored Firestore document is unaffected.

Also converted `core/inventory-engine/application/stock.ts`'s `AUDIT_ACTION_BY_MOVEMENT_TYPE` to be typed against `InventoryAuditAction` directly (was `AuditAction`, imported from `core/audit-logs`), and `core/companies/company.ts`'s `status === "suspended" ? ... : ...` ternary into an exhaustive `AUDIT_ACTION_BY_STATUS: Record<"active" | "suspended", CompanyAuditAction>` — the same compile-time-exhaustiveness pattern `AUDIT_ACTION_BY_MOVEMENT_TYPE` already used: a third `Company['status']` value added without extending this map is a type error, not a silent audit-coverage gap.

## 2. Pagination-ready Audit Log and Notification APIs

**Problem:** `listAuditLogs(companyId)` and `listNotifications(uid, opts?)` both read their entire collection unbounded and unordered — fine with no UI yet, but a real audit-log table or notification inbox would eventually need to fetch a bounded, ordered page, and retrofitting that onto an established signature later risks a breaking change.

**Fix:** Added `listAuditLogsPage(companyId, opts?)` and `listNotificationsPage(uid, opts?)` as new, purely additive functions — `listAuditLogs`/`listNotifications` are untouched (same signature, same behavior, same tests). Both new functions share one shape:
- `PageOptions = { limit?: number; cursor?: string }`, `Page<T> = { items: T[]; nextCursor: string | null }` — a generic pair in `src/shared/types/pagination.ts`, reusable by any future paginated Core list API.
- Server-side sort (`createdAt desc`, newest first) and server-side `limit` — no client-side filtering or sorting anywhere.
- Cursor-based, not offset-based (`opts.cursor` is opaque — callers only ever pass back a previous page's `nextCursor`, never construct one) — the standard approach for a collection that keeps growing, where an offset would drift as new entries are written between page reads.
- `listNotificationsPage` also accepts the existing `unreadOnly` filter, applied server-side before the sort/limit.

The shared cursor-resolution step (resolve the opaque cursor to a `DocumentSnapshot`, then `Query.startAfter()`) and the `DEFAULT_PAGE_SIZE` (50) constant were extracted into `src/lib/firebase/pagination.ts`'s `applyCursor()`/`DEFAULT_PAGE_SIZE`, removing what would otherwise be near-identical logic duplicated between `core/audit-logs` and `core/notifications`.

New composite Firestore index (`notifications: (readAt ASC, createdAt DESC)`, `queryScope: COLLECTION`) declared in `firestore.indexes.json` for `listNotificationsPage(uid, { unreadOnly: true })` — the one query shape here that filters on one field and sorts by another. See `docs/DATABASE.md` §4.

This design was chosen specifically to avoid a breaking change once a real UI arrives: adding a new optional filter to `PageOptions` later, or a new paginated list function following the same `{ items, nextCursor }` convention, extends the surface without touching any existing caller.

## 3. `markAllAsRead` beyond 500 notifications

**Problem:** `markAllAsRead(uid)` built one `adminDb.batch()` and called `.update()` once per unread notification before a single `.commit()`. Firestore rejects a `WriteBatch` beyond 500 operations — a user with more than 500 unread notifications would have this call fail outright.

**Fix:** The unread doc set is split into `<=500`-operation chunks (`MAX_BATCH_SIZE = 500`, Firestore's actual platform limit, not a tunable knob), each committed as its own `WriteBatch`, run concurrently via `Promise.all` (safe — each chunk touches a disjoint set of documents, so there's no write conflict between them). The external signature, `markAllAsRead(uid): Promise<void>`, and its behavior for any caller with 500 or fewer unread notifications, are unchanged.

Proven with both a unit test (600 mocked docs → 2 batch commits, exactly 500 + 100 updates split correctly) and an emulator test seeding 600 real notifications and asserting all 600 end up marked read.

## 4. General cleanup

- Extracted `applyCursor()`/`DEFAULT_PAGE_SIZE` (see §2) — the one real duplication surfaced while implementing pagination.
- No architectural changes: `audit-logs` and `notifications` remain flat modules (no new `domain`/`application`/`infrastructure` layering introduced); `inventory-engine`/`order-engine`/`companies` keep their existing structure, only gaining a colocated type export each.
- No breaking changes anywhere in this pass — confirmed by every pre-existing test file passing unmodified in behavior (only test *infrastructure*, i.e. mock query-chain shapes, needed updates to support the new chainable Firestore query mocks; no assertion on prior behavior changed).

## Testing

- Unit: `core/audit-logs/audit-logger.test.ts` and `core/notifications/notification.repository.test.ts` gained coverage for the new paginated functions (ordering, limiting, default page size, cursor resolution including a stale/deleted cursor, full-page vs. last-page `nextCursor`) and for `markAllAsRead`'s chunking at exactly 500 and above 500. New `src/lib/firebase/pagination.test.ts` covers `applyCursor` directly.
- Emulator: `core/audit-logs/audit-logger.emulator.test.ts` and `core/notifications/notification.emulator.test.ts` gained real-Firestore pagination tests (multi-page traversal with no duplicate/missing entries across pages) and a 600-notification `markAllAsRead` end-to-end test.
- All pre-existing unit, emulator, and security-rules tests continue to pass unmodified in assertions.

## Remaining technical debt

- `AuditAction`'s decentralization still relies on each domain module remembering to extend its own type when adding a mutation, and to actually call `writeAuditInTransaction` — nothing enforces the *call* happens, only that the action literal typechecks if it does. Same class of risk as before, just relocated.
- Cursor pagination here assumes single-field (`createdAt`) ordering is sufficient; a future UI wanting to sort by a different column (e.g. audit logs by actor) would need a new function or an extended `PageOptions`, not a change to the existing ones — by design, but worth flagging as a known limitation of the current shape.
- `markAllAsRead`'s concurrent chunk commits are not atomic across chunks — a crash between the first and second chunk's commit leaves some notifications read and others not. Acceptable for a "mark all as read" UX action (not a financial or inventory-consistency operation), but noted since it's a deliberate trade-off, not an oversight.
