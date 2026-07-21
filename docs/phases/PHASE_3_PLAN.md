# Phase 3 — Restaurant App (implemented)

Status: **approved and implemented.** This is the as-built record of the approved architectural plan (three review rounds: vertical selection, App Registry UI-independence, and the idempotency/consistency redesign) — see the phase's approval history for the full deliberation. Retail, Coffee Shop, Warehouse, Pharmacy, and Salon are documented future Apps that reuse the same skeleton.

## 1. Goals

Introduce `restaurant`, the first production App, on top of the unchanged Core/Platform/App Registry/Connectors/Settings architecture (Phases 1–2). Prove the full chain — App Registry registration → Platform entitlement/install → Core (Order/Inventory Engines) → Audit Logs → Notifications — end-to-end, with zero new Core capabilities beyond two small, generic, business-agnostic additions (§9) and zero new Platform capabilities.

## 2. Scope

Select branch; browse menu (items are `InventoryItem` references); start a pending order; add/update-quantity/remove order lines; choose order type (Dine In / Takeaway / Delivery); optional table reference and guest count; review totals; complete or void the order; order history.

**Explicitly out of scope:** Kitchen Display, Reservations, table maps, Loyalty, online ordering, WhatsApp, delivery-provider integrations, receipt hardware, complex modifiers, external connectors, payment/tender recording.

## 3. Why Restaurant Is First

Builds directly on the existing Order and Inventory Engines (a menu item is an `InventoryItem` reference; a ticket is Core's existing `createOrder → addOrderLine → completeOrder/voidOrder`); immediate real-world value; validates the App architecture under a realistic multi-step workflow (an order that stays open across multiple edits); avoids unnecessary complexity; and establishes the reference pattern every future vertical copies: (a) Core-owned vs. App-owned data split keyed by Core's own order ID, (b) the registry-without-React dynamic-routing mechanism, (c) the deterministic idempotency/repair model for App-owned metadata.

## 4. Architecture

```
Core (order-engine, inventory-engine, audit-logs, notifications, roles-permissions, companies)
   ▲  called directly, via Core's own exported service functions only
Platform (app-installs, licenses)         — unchanged, zero new capabilities
   ▲  entitlement + install-state checked once, at mount time, by the route layer
App Registry (pure data catalog)          — one field added: routeKey: string
   ▲
Apps/restaurant (domain, application, actions, components, routes)   — new
   ▲
Settings + Next.js route layer            — owns the routeKey → Component map
```

Restaurant imports Core directly and nothing else; it does not import Platform (entitlement/install checks happen only in the route layer and `platform/app-installs`) or Connectors (forbidden, enforced by ESLint zones and pinned by `tests/architecture/import-boundaries.test.ts`).

## 5. App Registration & Dynamic Routing

`AppManifest` gained one field: `routeKey: string` (replacing the Phase 2 placeholder `routes?: unknown`). This keeps App Registry a pure, zero-React data catalog — verified permanently by `tests/architecture/app-registry-no-react.test.ts`. The React mapping lives at the Next.js route layer: `src/app/(dashboard)/[companyId]/apps/[appId]/[[...slug]]/app-roots.ts` exports `APP_ROOT_COMPONENTS: Partial<Record<string, ComponentType<AppRootProps>>>`, and `AppMountPage` looks up `manifest.routeKey` there. An unmapped routeKey falls back to the existing "not available" placeholder rather than crashing. `src/app-registry/registry.ts` registers `restaurantManifest` (imported from `src/apps/restaurant/manifest.ts`) — the one pre-announced, narrow exception to App Registry's zero-dependency status (mirrors `connectors/registry.ts`'s one stub connector).

## 6. Core-Owned vs. Restaurant-Owned Data

**Core owns (unchanged, never duplicated):** order existence, lines, quantities, prices, totals, status, timestamps, branchId, inventory movement.

**Restaurant owns**, in `companies/{companyId}/apps/restaurant/orderMeta/{draftId}` (nested under the same document Platform's install-state already owns for this App): `orderId` (a reference to Core's order), `orderType`, `tableRef`, `guestCount`, `kitchenNote`, `status: "confirmed"`, `recordedAt`. Keyed by `draftId` — the client-originated request key, never Core's `orderId` — so the link between a logical request and its metadata is always exact, never inferred by actor/branch/time-window matching.

## 7. Idempotency & Consistency Model

The defect flagged during review: a naive check-then-act ("read draft status → decide to call Core → mark consumed") is a race — two concurrent requests can both observe "not yet created" before either writes, producing two Core orders for one logical request.

**The fix:** Core's `createOrder` gained an optional `idempotencyKey` parameter (`src/core/order-engine/application/orders.ts`), backed by a new, generic, business-agnostic collection `companies/{companyId}/idempotencyKeys/{key}` (`operation`, `resultId`, `createdAt`). Inside **one Firestore transaction**, `createOrder` reads the idempotency doc; if present, it returns the existing order (no new order created); if absent, it creates the order and writes the idempotency doc in the same transaction. Firestore's transaction retry semantics (not any application-level lock) make this exactly-once: two concurrent calls with the same key can only ever produce one order — the losing transaction is automatically retried and, on retry, takes the "already exists" branch. Verified directly by a concurrency test firing two simultaneous `createOrder` calls (and, at the App level, two simultaneous `createTicket` calls) with the same key and asserting exactly one order document exists afterward.

`draftId` (a client-generated UUID, minted once per logical "start order" submission and reused across any retry of that same submission) is used as this idempotency key. `order-ticket.service.ts`'s `createTicket`: (1) short-circuits if `orderMeta/{draftId}` already exists (cheap, no Core call); (2) otherwise calls `createOrder(..., { idempotencyKey: draftId })`; (3) writes `orderMeta/{draftId}` (idempotent merge-set) in its own small transaction, which re-checks for a concurrent write before writing. No heuristic (actor/branch/time-window) matching exists anywhere. If a freshly-returned order's status is anything other than `"pending"` — impossible for a truly new order, since `createOrder` always creates orders as `"pending"` — that is a deterministic, checkable signal that this is a **repair** (an earlier attempt's metadata write never landed), and only then does the transaction fire the one Restaurant-owned audit action, `restaurant.orderMetaRepaired`, atomically alongside the repair write; a notification to other Owners/Managers follows once the transaction commits.

## 8. Order Lifecycle

`createOrder` (idempotent) → `addOrderLine` / `updateOrderLineQuantity` / `removeOrderLine` (all Core, called directly) → `completeOrder` / `voidOrder` (Core). "Resume a pending order" and "abandon a pending order" are not separate Restaurant concepts: resuming re-opens the existing Core order; abandoning **is** voiding (`voidOrder`), reusing Core's existing state machine rather than inventing a new one.

## 9. The Two Small, Necessary Core Touch-Points

Beyond `AppManifest.routeKey` (§5) and the idempotency mechanism (§7), two more additive, non-breaking Core changes were required because the approved scope needed capabilities the Order Engine didn't yet expose:

- **`updateOrderLineQuantity` / `removeOrderLine`** (`core/order-engine`): the approved scope explicitly requires "update quantities" and "remove order lines," and only `addOrderLine` existed before. Both mirror `addOrderLine`'s exact transactional shape (re-check pending status inside the transaction, recompute totals from every line, `orders.create` capability — matching `addOrderLine`'s own capability, since Core has no separate "update" capability).
- **`listBranches`** (`core/companies`): the approved scope requires "select branch," and no general branch-listing query existed (1C only ever created one default branch and queried it ad hoc). Gated by the pre-existing `branch.view` capability; a pure additive read.

No new Core or Platform capability strings were introduced; no existing Core or Platform behavior changed for any caller that doesn't pass the new optional parameters.

## 10. Authorization

Reused directly from Core, zero new capabilities: view menu → `inventory.view`; create order / modify lines → `orders.create` (matching `addOrderLine`'s own existing capability); complete → `orders.complete`; void → `orders.void`; view history → `orders.view`. Restaurant-owned metadata (order type, table, guest count, kitchen note) is gated by the same capability as its parent action — no separate "Restaurant metadata" capability exists.

## 11. Audit & Notifications

Core's own `order.created` / `order.lineAdded` / `order.lineQuantityUpdated` / `order.lineRemoved` / `order.completed` / `order.voided` audits are never duplicated. Restaurant's own closed vocabulary is exactly one action, `restaurant.orderMetaRepaired` (§7), written atomically with its triggering write. Notifications: order voided, and the repair event — both to other Owners/Managers excluding the actor, reusing `listCompanyMembers` + `createNotification`/`createNotificationInTransaction`. No notification on routine completion.

## 12. Firestore Rules

Additive only: `idempotencyKeys/{key}` (Super Admin read only, writes Admin-SDK-only) at the company level; `apps/{appId}/orderMeta/{draftId}` (branch-scoped read, writes Admin-SDK-only) nested in the existing `apps/{appId}` block. No existing rule changed.

## 13. Testing

Unit tests (mocked Admin SDK) for the Core idempotency branch, `updateOrderLineQuantity`/`removeOrderLine`, `listBranches`, and every Restaurant repository/service/action. Emulator tests against the real Firestore Emulator, including the required concurrency tests (two simultaneous `createOrder` calls and two simultaneous `createTicket` calls sharing a key, each asserting exactly one order is created) and a repair-path test. Security-rules tests for `orderMeta` and `idempotencyKeys`. Architecture tests: import-boundary pins for `apps/restaurant`, no-React in App Registry, no-Firestore-import in any App's `components/`/`routes/`.

## 14. Estimated Files (actual)

New: ~20 (Restaurant's domain/application/actions/components/routes/tests, `app-roots.ts`, `restaurant.test.ts`, two new architecture-test files, `core/companies/branches.ts` + test). Modified: `core/order-engine` (orders.ts, types.ts, errors.ts, index.ts, both test files), `core/companies/index.ts`/`core/index.ts`, `app-registry` (types + registry.ts + both existing tests), the dynamic mount route, `firestore.rules`, `docs/DATABASE.md`/`ROADMAP.md`/`core/README.md`/`apps/README.md`/`app-registry/README.md`.
