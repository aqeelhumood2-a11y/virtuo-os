# Virtuo OS — Firestore Database Plan

Status: **proposed, awaiting approval.** No collections beyond the infra smoke-test exist yet.

## 1. Design principles applied

- **Company is the tenant boundary**, on every collection that isn't inherently global (`users`, global `licenses` catalog).
- **Shallow over deep**: prefer `companyId` fields + top-level (or one-level-nested) collections over deeply nested subcollections, so collection-group queries and pagination stay cheap. Subcollections are used only where data is always accessed in the parent's context and never queried across parents (e.g. `orders/{orderId}/lines`).
- **No duplicated data** — references (`userId`, `branchId`, `itemId`) instead of copying mutable fields; denormalize only immutable, display-only fields (e.g. cache `itemName` on a movement record for historical accuracy even if the item is later renamed) and only where read-cost otherwise requires an extra round trip on a hot path.
- Every collection maps 1:1 to a Core module or App/Connector — nothing "shared" or ambiguous in ownership.

## 2. Core collections (Phase 1–3)

`users`, `companies`, `companies/{companyId}/branches`, and `companies/{companyId}/memberships` were implemented in Phase 1C exactly as below (see `docs/phases/PHASE_1C_PLAN.md` for the full rationale); the fields here supersede the earlier speculative sketch — `lastLoginAt`, `industry`, `settings`, `address`/`timezone`, and `invitedBy` were all dropped as unused-at-the-time scaffolding, and `onboardedAt` was added as the transactional duplicate-onboarding guard. `capabilityOverrides` was re-added in Phase 1D, per `ARCHITECTURE.md` §5's explicit allowance for it as a data-model-only field (no guard reads it yet).

```
users/{uid}                                      # doc ID == Firebase Auth UID
  uid, email, displayName, photoURL, status (active|disabled),
  onboardedAt (set once, inside the onboarding transaction), createdAt
  # NOT company-scoped — a user can belong to multiple companies

companies/{companyId}
  name, ownerId (creator/initial Owner; provenance, not the authorization
  source -- that's always the membership role), status (active|suspended),
  createdAt

companies/{companyId}/branches/{branchId}
  name, isActive, isDefault (true only for onboarding's default branch), createdAt

companies/{companyId}/memberships/{uid}          # doc ID == uid, 1 membership per user per company
  uid, role: Owner | Manager | Supervisor | Employee
  branchIds: string[]                             # branches this member is scoped to ([] = all)
  status (active|invited|disabled — only 'active' is ever produced in 1C), joinedAt
  capabilityOverrides?: Capability[]               # 1D data-model allowance; unread until an override UI ships
  # SuperAdmin is a global concept (a custom claim), never a membership role

companies/{companyId}/licenses/{licenseId}          # usually one active doc
  plan, installedApps: string[], installedConnectors: string[], seats, renewsAt

companies/{companyId}/apps/{appId}                  # install state, mirrors licenses.installedApps for fast reads
  enabled, installedAt, config: {...}

companies/{companyId}/connectors/{connectorId}
  status (connected|disconnected|error), lastSyncAt, config: {...}   # credentials NOT stored here, see §5

# --- Inventory Engine (Core, reused by every vertical) --- implemented Phase 1E,
# see docs/phases/PHASE_1E_PLAN.md
companies/{companyId}/inventoryItems/{itemId}          # company-wide catalog, not branch-scoped
  sku, name, unit, category, isActive, defaultPrice, createdAt

companies/{companyId}/stock/{stockId}                # stockId = `${branchId}_${itemId}` for O(1) lookup
  branchId, itemId, quantityOnHand, reorderPoint, updatedAt

companies/{companyId}/inventoryMovements/{movementId}
  itemId, branchId, type (receive|adjust|transfer|sale|waste), quantityDelta, itemNameSnapshot,
  reason, performedBy, transferGroupId? (links a transfer's paired out/in entries), createdAt
  # append-only audit trail; quantityOnHand on `stock` is the derived/cached total.
  # 'sale' is reserved for the Order Engine (1F) to write -- no 1E function produces it.
  # relatedOrderId was dropped from the original sketch: nothing produces it until 1F exists,
  # and it will be added then rather than carried as an unused field now.

# --- Order Engine (Core, reused by every vertical) --- implemented Phase 1F,
# see docs/phases/PHASE_1F_PLAN.md
companies/{companyId}/orders/{orderId}
  branchId, appId (free-form tag naming which App created it -- no App
  registry exists until Phase 3, so this is recorded, never validated),
  status: pending | completed | voided,
  customerRef?, totals: { subtotal, tax, discount, total }, createdBy, createdAt, updatedAt

companies/{companyId}/orders/{orderId}/lines/{lineId}    # subcollection: always read with the parent order
  branchId (denormalized from the parent order, same reason inventoryMovements carries its own),
  itemId, itemNameSnapshot, quantity, unitPrice, lineTotal

# --- Cross-cutting Core services --- implemented Phase 1G,
# see docs/phases/PHASE_1G_PLAN.md
companies/{companyId}/auditLogs/{logId}
  actorId, action, targetType, targetId, branchId?, before?, after?, createdAt
  # append-only, written by core/audit-logs's writeAuditInTransaction() — every
  # mutation path from 1C-1F calls this inside the same transaction as the
  # mutation it records, no exceptions and no separate best-effort write

users/{userId}/notifications/{notificationId}
  title, body, channel, readAt?, createdAt, relatedEntity?
  # per-user, not per-company — a user sees their own notifications across companies
  # only channel implemented so far is "in-app" (core/notifications/channels/in-app.ts)
```

## 3. App-owned collections (Phase 4+, namespaced so ownership is unambiguous)

```
companies/{companyId}/apps/restaurant/tables/{tableId}
companies/{companyId}/apps/kitchenDisplay/tickets/{ticketId}
companies/{companyId}/apps/loyalty/programs/{programId}
companies/{companyId}/apps/loyalty/members/{memberId}
companies/{companyId}/apps/barcode/scanLogs/{scanId}
```

Rule: an App may create collections only under `companies/{companyId}/apps/{itsOwnAppId}/...`. It never writes to another App's namespace, and it reaches Inventory/Orders only through the Core engine's application-layer functions, never by writing to `inventoryItems`/`orders` directly.

## 4. Indexes

**Implemented (Phase 1C):** one collection-group composite on `memberships`: `(uid ASC, status ASC)`, plus the field override enabling collection-group query scope on `memberships.uid`. This is exactly what `listMyCompanies(uid)` needs ("what companies do I belong to") — confirmed required the hard way: it was declared in `firestore.indexes.json` but not deployed to the live project during Phase 1C's manual verification, which surfaced a real `FAILED_PRECONDITION` error. **Deploying an index is a separate step from declaring it** (`firebase deploy --only firestore:indexes`, or the direct link Firestore's own error message provides) — noted here so it isn't missed again. Two other composites considered during planning (`branches (isActive, createdAt)`, per-company `memberships (status, joinedAt)`) were **removed** before implementation because no query in the actual code uses that shape yet — added incrementally as real queries are written, not speculatively upfront, per this section's own principle.

**Implemented (Phase 1E):** none needed. `stock` and `inventoryMovements` are only ever queried with a single equality filter (`branchId`), which Firestore serves from its automatic single-field indexes — no composite declared or deployed. The `inventoryMovements: (itemId ASC, createdAt DESC)` composite anticipated below was deliberately **not** built in 1E because no function queries movements by item across branches yet (`listMovementsForBranch` only, see `docs/phases/PHASE_1E_PLAN.md` §6) — added only when a real caller needs it, per this section's own principle.

**Implemented (Phase 1F):** none needed, same reasoning as 1E — `listOrdersForBranch` uses a single `branchId` equality filter.

Anticipated for later phases, added only once a real query needs them:
- `orders`: `(branchId ASC, status ASC, createdAt DESC)`, if a status-filtered or sorted order list is ever built
- `inventoryMovements`: `(itemId ASC, createdAt DESC)`, if a cross-branch per-item history view is ever built
- `auditLogs`: `(actorId ASC, createdAt DESC)`

## 5. Secrets & credentials — explicitly NOT in Firestore

Connector credentials (API keys, OAuth tokens for Shopify/Square/Odoo/etc.) are never stored as plain Firestore fields. Phase 2 will wire these through a secret store (Google Secret Manager, referenced by name/version from the `connectors/{connectorId}` doc) so Firestore only ever holds a *pointer*, never the secret itself — consistent with the spec's "no hardcoded secrets" / "never expose secrets" rules.

## 6. Security Rules strategy

**Implemented (Phase 1C + 1D + 1E + 1F + 1G)**, in `firestore.rules`, for `users`/`companies`/`branches`/`memberships`/`inventoryItems`/`stock`/`inventoryMovements`/`orders`/`orders/lines`/`auditLogs`/`users/{uid}/notifications`: shared helpers (`isActiveMember`, `hasCapability`, `hasBranchAccess`, `isSuperAdmin`, etc.) reading `companies/{companyId}/memberships/{request.auth.uid}`, implemented once and reused across every match block. `stock`/`inventoryMovements`/`orders`/`orders/lines` reads additionally require the caller's `branchIds` to include the document's `branchId` (empty `branchIds` = all branches) — order lines carry their own denormalized `branchId` so this never needs a parent-order lookup. `isSuperAdmin()` grants a cross-tenant read bypass on every company-scoped collection above (not `notifications`, which is per-user, not per-company) for the global `superAdmin` custom claim; it grants no write access anywhere. Every client write to every collection above is denied outright (`allow write: if false`); all mutation goes through server code using the Admin SDK, gated by `requireCapability()` (and, for branch-scoped collections, `hasBranchAccess()`) before it ever reaches Firestore. Full rationale in `docs/phases/PHASE_1C_PLAN.md` §4, `docs/phases/PHASE_1D_PLAN.md` §6, `docs/phases/PHASE_1E_PLAN.md` §7, `docs/phases/PHASE_1F_PLAN.md` §7, and `docs/phases/PHASE_1G_PLAN.md` §6.

**Changed in 1G:** the `companies` update rule that 1D added — `hasCapability(companyId, 'company.update' | 'company.suspend')`, gating a direct, capability-checked client write — is now `allow update: if false`. A direct client write has no server-side interception point to write an audit log entry from, and 1G's "every mutation from 1C–1F is audited, no exceptions" requirement doesn't hold with an un-auditable path left standing. Company rename/suspend now go through `updateCompanyAction`/`suspendCompanyAction` (Admin SDK + `writeAuditInTransaction`, in the same transaction as the update), same as every other mutation in Core. The rules-side `roleCapabilities()` mirror of `core/roles-permissions/matrix.ts`'s `ROLE_CAPABILITIES` now only needs to model `audit.view` (Owner/Manager), since every other capability's mutation is Admin-SDK-only and has no rules-side capability check left to mirror.

`auditLogs` read is gated by `audit.view` (Owner/Manager, plus the `superAdmin` bypass); write is `if false` unconditionally — the only writer is `core/audit-logs`'s `writeAuditInTransaction()`, called inside the same transaction as the mutation it records, never as a standalone write. `users/{uid}/notifications/{notificationId}` read is self-only (`isSelf(uid)`, no `superAdmin` bypass — notifications are a personal inbox, not tenant data); write is `if false` — even marking one's own notification read goes through `core/notifications`'s `markAsRead()`/`markAllAsRead()` (Admin SDK).

Note this **supersedes** the originally-sketched aspirational shape (a generic `hasCapability(companyId, '<collection>.write')` direct-client-write rule per collection) — `ARCHITECTURE.md` §6 is explicit that inventory adjustments and order status changes go through server-side logic, not rule-gated direct writes, and the multi-document atomicity these transactions need (an order's status change plus every line's stock deduction, in one commit) couldn't be expressed safely as a rules-only invariant regardless.
