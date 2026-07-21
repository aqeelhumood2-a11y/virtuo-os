# Phase 4.2 — Loyalty App (implemented)

Status: **approved and implemented**, per the architecture proposal review with three explicit decisions (§13.1, §13.2, §13.7 of that proposal). This is the as-built record.

## 1. Goals

Ship a working points-accrual system for completed orders, staff-operable, cross-cutting across both Restaurant and Retail, built entirely on existing infrastructure: App Registry, Core's audit log (read-only), Core's `Role` type, and the same App-owned-Firestore-namespace/repository/service/actions shape Restaurant and Retail already established. Zero new Core capabilities; zero changes to Core, Platform, Restaurant, or Retail code.

## 2. Approved Decisions

- **§13.1 Accrual timing:** lazy/on-demand only. No Cloud Functions, Cloud Scheduler, background workers, or new event infrastructure. `syncAccruals` runs automatically when an authorized user opens the Loyalty app, plus a manual "Sync Now" action.
- **§13.2 Attribution mechanism:** a Loyalty-owned mapping, `companies/{companyId}/apps/loyalty/attributions/{orderId}`. Restaurant, Retail, and Core are not modified. Checkout-time customer capture remains a future enhancement (Backlog).
- **§13.7 Redemption:** explicitly out of scope. This phase covers enrollment, attribution, automatic accrual, balance, ledger, and synchronization only.

## 3. Scope

**In scope:** enroll a member (name + contact reference); attribute a completed order to a member; automatically compute and record points earned from that order's total on sync; view a member's balance and ledger history; manual "Sync Now."

**Out of scope:** redemption; any customer-facing login/portal; any new Core event/pub-sub mechanism; notifications beyond none in this first cut; a per-company configurable points ratio (fixed at 1 point per currency unit for now).

## 4. Architecture

```
Core (order-engine writes order.completed to auditLogs, atomically, since 1G -- unchanged)
   ▲  read-only: listAuditLogsPage(companyId, opts) -- already existed, Phase 1G
Platform (app-installs, licenses)         — unchanged, untouched
   ▲
App Registry (pure data catalog)          — one more registerApp() call, routeKey: "loyalty"
   ▲
Apps/loyalty (domain, application, actions, components, routes)   — new
   ▲
Settings + Next.js route layer            — one more routeKey → Component entry
```

Loyalty imports `@/core` only — no Platform, no Connectors, no Restaurant, no Retail. Pinned by the same import-boundary architecture tests already extended for each prior App.

## 5. Ownership Boundaries and Data Model

**Core owns, unchanged:** order existence, lines, totals, status, timestamps, branchId, and the `order.completed` audit entries Loyalty reads.

**Loyalty owns**, under `companies/{companyId}/apps/loyalty/...`:

```
members/{memberId}          -- name, contactRef, pointsBalance, createdAt
ledger/{ledgerEntryId}      -- memberId, type: "earned"|"adjusted", points (signed),
                                orderId? (for "earned"), reason?, actorId, createdAt
attributions/{orderId}      -- memberId, attributedBy, createdAt
syncCursor/default          -- lastProcessedLogId, lastSyncedAt (internal only)
```

`pointsBalance` is denormalized, updated via `FieldValue.increment()` in the same transaction as each ledger append -- reusing Core's own Inventory Engine pattern (`stock.quantityOnHand` + `inventoryMovements`), not a new design.

## 6. Repositories (`application/*.repository.ts`)

`member.repository.ts`, `ledger.repository.ts`, `attribution.repository.ts`, `sync-cursor.repository.ts` -- each raw Firestore reads/writes to exactly one of the collections above, no business rules, matching every other App's repository convention.

## 7. Services (`application/loyalty.service.ts`)

`enrollMember`, `attributeOrderToMember`, `syncAccruals`, `getMemberBalance`, `listAllMembers`, `listLedgerEntriesForMember`.

### The accrual engine (`syncAccruals`)

1. Reads the stored sync cursor (a prior audit-log entry's own ID, or `null` on first run).
2. Calls Core's existing `listAuditLogsPage` (newest-first, unchanged since Phase 1G), paginating backward page by page until it finds the stored cursor (or exhausts the log on first run), collecting `order.completed` entries newer than it.
3. Processes the newly-found entries oldest-first: for each, looks up its attribution; if attributed and not already accrued (`getLedgerEntryByOrderId` idempotency guard), computes `points = floor(order.totals.total * 1)` via Core's `getOrder` and writes the ledger entry + balance increment + `loyalty.pointsEarned` audit atomically in one transaction.
4. Advances the cursor to the last entry examined -- monotonically, once, regardless of whether that entry was attributed.

### Deliberate, documented limitation

The cursor advances past every `order.completed` entry it examines, attributed or not. **An order not yet attributed by the time sync next runs will not be revisited by a later sync — its automatic-accrual window is closed, not retried indefinitely.** This was a conscious trade-off (see the approved proposal §13.1/§13.2): it keeps the cursor strictly monotonic, bounds every sync run's scan cost, and prevents one perpetually-unattributed order from blocking every later order's accrual (a "head of line blocking" failure mode that an alternative "only advance past resolved entries" design would have introduced). Verified directly by an emulator test (`loyalty.service.emulator.test.ts`): attributing an order *after* a sync run has already passed it does not retroactively accrue.

### Branch-access handling

`getOrder` (Core) enforces the caller's own branch access; a sync-triggering actor may lack access to some orders' branches. `syncAccruals` catches `BranchAccessDeniedError` per-entry and skips rather than aborting the whole run -- applying, in new code, the exact lesson from the pre-existing Restaurant `listOrderHistory` gap (tracked as [issue #2](https://github.com/aqeelhumood2-a11y/virtuo-os/issues/2)), without touching that issue's own file.

## 8. Permissions

**No new capability is introduced anywhere — Core or otherwise.** Loyalty branches directly on `membership.role`, the same inline pattern Restaurant/Retail's own `otherAdminUids` helper already uses:

| Action | Gate |
|---|---|
| View a member's balance/ledger | any active member |
| Enroll a member / attribute an order | frontline (`Owner`/`Manager`/`Supervisor`/`Employee`) |
| Trigger `syncAccruals` (auto or manual) | Core's existing `audit.view` capability (Owner/Manager), enforced entirely by `listAuditLogsPage`'s own internal `requireCapability` call -- not duplicated in Loyalty's own code |

The auto-sync-on-mount and the "Sync Now" button are both gated in the UI by `hasCapability(membership.role, "audit.view")` (a plain boolean check, no redirect) -- a caller without it simply sees the read-only dashboard.

## 9. Audit and Notifications

```ts
type LoyaltyAuditAction = "loyalty.memberEnrolled" | "loyalty.pointsEarned";
```

Written via `writeAuditInTransaction<LoyaltyAuditAction, "loyaltyMember" | "loyaltyLedgerEntry">`, atomically alongside each triggering write -- the exact generic mechanism from Phase 2/3, zero Core changes. No notifications in this first cut (matching Retail's own minimal-first-slice precedent).

## 10. Firestore Rules and Indexes

Additive only, nested in the existing `apps/{appId}` block: `members`, `ledger`, `attributions` readable by any active member (not branch-scoped -- a member and their ledger aren't tied to one branch); `syncCursor` readable only by a Super Admin claim holder (internal bookkeeping, same tier as Core's own `idempotencyKeys`). All writes Admin-SDK-only. One new composite index, `ledger (memberId ASC, createdAt DESC)`, for `listLedgerForMember`. No existing rule or index changed.

## 11. UI

`LoyaltyDashboard` (members list, enroll form, attribute-order form, conditional "Sync Now") at `/{companyId}/apps/loyalty`; `MemberLedger` at `/member/:memberId`. Same slug-dispatch pattern `RestaurantAppRoot`/`RetailAppRoot` established.

## 12. Testing

Unit tests (mocked `@/core` and each repository) for every repository and for `loyalty.service.ts`, including dedicated pagination/cursor-boundary tests and the branch-access-skip path. Emulator tests seed real completed orders via Core's own `createOrder`/`completeOrder` directly (tagged `appId: "restaurant"` and `appId: "retail"`), proving cross-vertical accrual is identical; a dedicated idempotent-double-sync test; the documented late-attribution-limitation test; an attribution-conflict test. Security-rules tests for all four collections. Architecture tests: import-boundary pins for `apps/loyalty` (the existing generic `apps-ui-no-firestore.test.ts`/`app-registry-no-react.test.ts` already cover it without changes).

## 13. Backlog (explicitly not built this phase)

- Point redemption.
- Extending Restaurant/Retail checkout to collect `customerRef` directly, replacing the manual attribution step.
- Real-time/event-driven accrual via new infrastructure (Cloud Functions/Scheduler).
- A per-company configurable points-per-currency-unit ratio.
- Redemption/large-transaction notifications.
- Any customer-facing portal.
- Retrying accrual for an order attributed after its sync window has already passed (the documented limitation in §7).

## 14. Estimated Files (actual)

New (~19): `src/apps/loyalty/{manifest.ts, domain/{loyalty.types,loyalty-audit.types,errors}.ts, application/{member,ledger,attribution,sync-cursor}.repository.ts (+4 tests), application/loyalty.service.ts (+unit +emulator tests), actions.ts (+test), components/{EnrollMemberForm,AttributeOrderForm,SyncNowButton,MemberList,MemberLedger,LoyaltyDashboard}.tsx, routes/LoyaltyAppRoot.tsx}`, `tests/security-rules/loyalty.test.ts`, this plan doc. Modified (~7): `app-registry/registry.ts` (+its test), `app-roots.ts`, `tests/architecture/import-boundaries.test.ts`, `firestore.rules`, `firestore.indexes.json`, `docs/{ROADMAP.md,DATABASE.md}`, `apps/README.md`.
