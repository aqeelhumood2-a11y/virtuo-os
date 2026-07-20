# Virtuo OS — Firestore Database Plan

Status: **proposed, awaiting approval.** No collections beyond the infra smoke-test exist yet.

## 1. Design principles applied

- **Company is the tenant boundary**, on every collection that isn't inherently global (`users`, global `licenses` catalog).
- **Shallow over deep**: prefer `companyId` fields + top-level (or one-level-nested) collections over deeply nested subcollections, so collection-group queries and pagination stay cheap. Subcollections are used only where data is always accessed in the parent's context and never queried across parents (e.g. `orders/{orderId}/lines`).
- **No duplicated data** — references (`userId`, `branchId`, `itemId`) instead of copying mutable fields; denormalize only immutable, display-only fields (e.g. cache `itemName` on a movement record for historical accuracy even if the item is later renamed) and only where read-cost otherwise requires an extra round trip on a hot path.
- Every collection maps 1:1 to a Core module or App/Connector — nothing "shared" or ambiguous in ownership.

## 2. Core collections (Phase 1–3)

`users`, `companies`, `companies/{companyId}/branches`, and `companies/{companyId}/memberships` were implemented in Phase 1C exactly as below (see `docs/phases/PHASE_1C_PLAN.md` for the full rationale); the fields here supersede the earlier speculative sketch — `lastLoginAt`, `industry`, `settings`, `address`/`timezone`, and `capabilityOverrides`/`invitedBy` were all dropped as unused-at-the-time scaffolding, and `onboardedAt` was added as the transactional duplicate-onboarding guard.

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
  # SuperAdmin is a global concept (a custom claim), never a membership role

companies/{companyId}/licenses/{licenseId}          # usually one active doc
  plan, installedApps: string[], installedConnectors: string[], seats, renewsAt

companies/{companyId}/apps/{appId}                  # install state, mirrors licenses.installedApps for fast reads
  enabled, installedAt, config: {...}

companies/{companyId}/connectors/{connectorId}
  status (connected|disconnected|error), lastSyncAt, config: {...}   # credentials NOT stored here, see §5

# --- Inventory Engine (Core, reused by every vertical) ---
companies/{companyId}/inventoryItems/{itemId}
  sku, name, unit, category, isActive, defaultPrice

companies/{companyId}/stock/{stockId}                # stockId = `${branchId}_${itemId}` for O(1) lookup
  branchId, itemId, quantityOnHand, reorderPoint, updatedAt

companies/{companyId}/inventoryMovements/{movementId}
  itemId, branchId, type (receive|adjust|transfer|sale|waste), quantityDelta, itemNameSnapshot,
  reason, performedBy, relatedOrderId?, createdAt
  # append-only audit trail; quantityOnHand on `stock` is the derived/cached total

# --- Order Engine (Core, reused by every vertical) ---
companies/{companyId}/orders/{orderId}
  branchId, appId (which App created it: retail|restaurant|...), status,
  customerRef?, totals: { subtotal, tax, discount, total }, createdBy, createdAt, updatedAt

companies/{companyId}/orders/{orderId}/lines/{lineId}    # subcollection: always read with the parent order
  itemId, itemNameSnapshot, quantity, unitPrice, lineTotal

# --- Cross-cutting Core services ---
companies/{companyId}/auditLogs/{logId}
  actorId, action, targetType, targetId, before?, after?, createdAt
  # append-only, written by core/audit-logs — every mutation path calls this, no exceptions

users/{userId}/notifications/{notificationId}
  title, body, channel, readAt?, createdAt, relatedEntity?
  # per-user, not per-company — a user sees their own notifications across companies
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

Anticipated for later phases, added only once a real query needs them:
- `orders`: `(branchId ASC, status ASC, createdAt DESC)`
- `inventoryMovements`: `(itemId ASC, createdAt DESC)` and `(branchId ASC, createdAt DESC)`
- `auditLogs`: `(actorId ASC, createdAt DESC)`

## 5. Secrets & credentials — explicitly NOT in Firestore

Connector credentials (API keys, OAuth tokens for Shopify/Square/Odoo/etc.) are never stored as plain Firestore fields. Phase 2 will wire these through a secret store (Google Secret Manager, referenced by name/version from the `connectors/{connectorId}` doc) so Firestore only ever holds a *pointer*, never the secret itself — consistent with the spec's "no hardcoded secrets" / "never expose secrets" rules.

## 6. Security Rules strategy

**Implemented (Phase 1C)**, in `firestore.rules`, for `users`/`companies`/`branches`/`memberships`: shared helpers (`isActiveMember`, `isOwner`, etc.) reading `companies/{companyId}/memberships/{request.auth.uid}`, implemented once and reused across every match block. There is no `hasCapability()`/capability-matrix yet — 1C's rules only special-case `'Owner'` vs. "any active member," since the full capability matrix is a Phase 1D concern. Every client write to these four collections is denied outright (`allow write: if false`); all mutation goes through server code using the Admin SDK, which bypasses rules entirely. Full rationale in `docs/phases/PHASE_1C_PLAN.md` §4.

**Aspirational (Phase 1D+)**, once a real capability matrix exists, later collections (inventory, orders, etc.) are expected to follow the shape sketched originally:

```
match /companies/{companyId}/{collection}/{docId} {
  allow read: if isMember(companyId);
  allow write: if hasCapability(companyId, '<collection>.write');
}
```
