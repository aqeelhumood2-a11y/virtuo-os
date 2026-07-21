# Phase 1G — Audit Logs and Notifications: Implementation Plan

Status: **approved, implemented.**

## 1. Audit log data model

New `core/audit-logs` module (flat, not `domain`/`application`/`infrastructure` layered — same reasoning as `core/companies`: the logic here is a single write-through primitive plus one read function, not enough surface to earn Inventory/Order Engine's layering).

- **AuditAction** — a fixed union, one entry per mutation path in 1C–1F (`company.onboarded`, `company.updated`, `company.suspended`, `company.reactivated`, `membership.roleUpdated`, `membership.deactivated`, `inventory.itemCreated/itemUpdated/itemDeactivated`, `inventory.stockReceived/Wasted/Adjusted/Counted/Transferred/Sold`, `order.created/lineAdded/completed/voided`) — never a free-form string, same convention as `MovementType`/`OrderStatus`.
- **AuditLogEntry** — `id`, `actorId`, `action`, `targetType` (`company | membership | inventoryItem | stock | order`), `targetId`, `branchId?`, `before?`, `after?`, `createdAt`. `before`/`after` are small, shallow snapshots only (a role string, a status, a quantity) — never a full document or a large array (an order's line items).

## 2. Event generation strategy

`writeAuditInTransaction(transaction, params)` is the single write-through primitive every mutation path calls, always inside the **same Firestore transaction** as the mutation it records — never a separate best-effort write, so a mutation and its audit entry always commit or roll back together.

One open question this plan flagged before implementation: 1D's company rename/suspend was the only mutation in Core that bypassed server code entirely — a direct, capability-gated client write, permitted by `firestore.rules`. That path has no server-side interception point to log from, so it couldn't satisfy "every mutation from 1C–1F is audited, no exceptions" as written. **Approved resolution: the server-side approach.** `core/companies/company.ts` adds `updateCompanyName`/`setCompanyStatus`, and `core/companies/actions.ts` adds `updateCompanyAction`/`suspendCompanyAction` (CSRF-protected Server Actions) routing rename/suspend through Admin SDK + `writeAuditInTransaction`, same as every other mutation in Core. `firestore.rules`' `companies` update rule changes from a capability-gated direct write to `allow update: if false` unconditionally.

Every other integration point needed no new interception — the mutation functions themselves already ran inside a transaction (or were wrapped in one for this phase, see §4):
- `commitStockChangePlan` (Inventory Engine) writes one audit entry per stock change — every caller that reaches it (`receiveStock`/`wasteStock`/`adjustStock`/`recordStockCount`, and Order Engine's per-line stock effect inside `completeOrder`/`voidOrder`) gets audit logging with no per-call-site wiring. `transferStock` has its own bespoke two-branch transaction (never routes through `commitStockChangePlan`), so it writes its own entry.
- Order Engine additionally writes one entry per order-level status change (`order.created`, `order.lineAdded`, `order.completed`, `order.voided`) — on top of, not instead of, the per-line stock entries `commitStockChangePlan` already writes.

## 3. Notification architecture

New `core/notifications` module: a thin channel abstraction so a future email/SMS/WhatsApp channel is additive, never a rewrite of the call sites.
- `channels/in-app.ts` — the only channel implemented now. `sendInAppInTransaction`/`sendInApp` write to `users/{uid}/notifications`.
- `notification.repository.ts` — `createNotification`/`createNotificationInTransaction` dispatch to the in-app channel; `listNotifications(uid, { unreadOnly? })`, `markAsRead(uid, id)`, `markAllAsRead(uid)` (batch write) round out the read/mark-read surface.

Per-user, not per-company — a user sees their own notifications across every company they belong to, same reasoning as `users/{uid}` itself. No capability check inside the module: `uid` is a trusted parameter, same convention as `core/users/profile.ts`'s `getUserProfile(uid)` — the caller (a Server Action reading its own verified session) is responsible for only ever passing its own uid or an explicitly-intended recipient's uid.

First (and so far only) caller: `core/companies/members-actions.ts`'s `updateMemberRoleAction`/`deactivateMemberAction` notify the affected member, in the same transaction as the membership update and its audit log entry.

## 4. Integration points with previous phases

- `core/companies/onboarding.ts` — one `company.onboarded` entry inside the existing onboarding transaction.
- `core/companies/company.ts` (new) — `updateCompanyName`/`setCompanyStatus`, each wrapped in `adminDb.runTransaction`, writing `company.updated`/`company.suspended`/`company.reactivated`.
- `core/companies/members-actions.ts` — `updateMembershipRoleInTransaction`/`deactivateMembershipInTransaction` (renamed from the non-transactional `updateMembershipRole`/`deactivateMembership`, now synchronous and transaction-composable, same `plan/commit`-style convention as Inventory Engine) are called inside a new `adminDb.runTransaction` alongside `writeAuditInTransaction` and `createNotificationInTransaction`.
- `core/inventory-engine/application/items.ts` — `createItem`/`updateItem`/`deactivateItem` each gained their own transaction (none existed before this phase) wrapping the write and its audit entry.
- `core/inventory-engine/application/stock.ts` — `commitStockChangePlan` writes one audit entry per call; `transferStock` writes its own.
- `core/order-engine/application/orders.ts` — `createOrder`/`addOrderLine`/`completeOrder`/`voidOrder` each write one order-level entry inside their existing transaction.

## 5. Firestore structure

```
companies/{companyId}/auditLogs/{logId}
  actorId, action, targetType, targetId, branchId?, before?, after?, createdAt

users/{uid}/notifications/{notificationId}
  title, body, channel ("in-app"), readAt?, createdAt, relatedEntity?
```

No new indexes: `listAuditLogs`/`listNotifications` are unfiltered per-company/per-user reads (single collection, no `where` beyond `listNotifications`'s optional `readAt == null` equality, served by Firestore's automatic single-field index).

## 6. Security model

`firestore.rules` additions/changes:
- `companies` update: **capability-gated direct write → `allow update: if false`** (see §2). The rules-side `roleCapabilities()` mirror of `core/roles-permissions/matrix.ts` now only needs `audit.view` (Owner/Manager) — every other capability's mutation is Admin-SDK-only with nothing left to mirror.
- `companies/{companyId}/auditLogs/{logId}` — read gated by `hasCapability(companyId, 'audit.view')` or the `superAdmin` bypass; write `if false` unconditionally (the only writer is `writeAuditInTransaction`, always inside the mutation's own transaction).
- `users/{uid}/notifications/{notificationId}` — read gated by `isSelf(uid)` only (no `superAdmin` bypass — a personal inbox, not tenant data); write `if false` unconditionally (even marking one's own notification read goes through `markAsRead`/`markAllAsRead`, Admin SDK).

New capability: `audit.view`, granted to Owner and Manager (audit history is manager-level visibility, not frontline — same tier as `membership.view`'s broader counterpart, `membership.updateRole`).

## 7. Testing strategy

- Unit (mocked Admin SDK + mocked `roles-permissions`): `writeAuditInTransaction` strips `companyId` from the written entry and never checks a capability itself (it's an internal recording primitive, not an entry point); `listAuditLogs` requires `audit.view`. In-app channel writes the expected doc shape (`readAt: null`, `channel: "in-app"`); repository-level `listNotifications`/`markAsRead`/`markAllAsRead` mapping and batch behavior. `company.ts`'s `updateCompanyName`/`setCompanyStatus` capability + before/after values + action selection (`suspended` vs `reactivated`). Every existing test file whose module gained a transaction wrapper or a renamed transactional function (`membership.test.ts`, `members-actions.test.ts`, `items.test.ts`, `stock.test.ts`, `orders.test.ts`) updated to match, with `@/core/audit-logs` mocked out so audit writes don't need their own collection entry in each file's fake Admin SDK.
- Emulator (real transactions, pinned to `// @vitest-environment node` per 1E's discovery): a mutation and its audit entry commit together; a mutation that throws (company not found) rolls back the whole transaction, including the audit write; `audit.view` gating proven against the real capability matrix (Owner/Manager succeed, Employee is redirected). Notification create → list → mark-read → mark-all-read round trip against the real emulator, plus the transactional variant and per-user isolation.
- Security rules (own unique emulator project ID, `demo-rules-test-audit`, per 1E's cross-file-interference fix): `auditLogs` read allow/deny by role plus SuperAdmin bypass, write always denied; `notifications` self-only read (no SuperAdmin bypass), write always denied even for the owning user; `companies` update now denied for every role including Owner (updated in `companies.test.ts`, replacing the 1D tests that asserted the direct write succeeded).

## 8. Acceptance criteria

- Every mutation from 1C–1F (company onboard/rename/suspend, membership role change/deactivation, inventory item create/update/deactivate, every stock movement type, every order lifecycle transition) writes exactly one matching audit log entry, atomically with the mutation.
- No mutation path writes without a matching log entry, and no log entry exists without its mutation having actually happened (proven by the rollback emulator test).
- `auditLogs` reads are Owner/Manager-only; all direct client writes to `companies`/`auditLogs`/`notifications` are denied.
- The affected member receives an in-app notification on role change and on deactivation.
- Lint, typecheck, unit tests, emulator tests, and build all pass.

## 9. Remaining risks

- Same rules-side/TS-side hand-sync risk as every prior phase: `roleCapabilities()` in `firestore.rules` mirrors `core/roles-permissions/matrix.ts`'s `ROLE_CAPABILITIES` by hand for the one capability (`audit.view`) it needs to check directly.
- `AuditAction` is a closed union by design — adding a new mutation path in a future phase requires remembering to extend it and to call `writeAuditInTransaction` from the new path; nothing enforces this at compile time beyond code review discipline (same shape as `MovementType`/`OrderStatus`).
- No UI surfaces audit logs or notifications yet (no vertical UI exists until Phase 3) — `listAuditLogs`/`listNotifications` are plain server-only functions, unconsumed until then.
- `markAllAsRead`'s batch write has no pagination guard; a user with an extremely large unread count could in principle exceed Firestore's per-batch write limit (500) — not a realistic volume for 1G's single in-app channel, revisit if usage patterns change.
