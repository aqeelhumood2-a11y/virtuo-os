# Phase 4.1 — Retail App (implemented)

Status: **approved and implemented, scoped to 4.1 only.** Phase 4.2 (Loyalty) is a separate, not-yet-implemented phase — see `docs/ROADMAP.md`'s Phase 4 entry for the decided-but-unbuilt approach (Loyalty reads Core's existing `auditLogs` for `order.completed` entries; no new Core event mechanism).

## 1. Goals

Add the second production App, `retail`, proving the architecture established in Phase 3 (App Registry → Platform entitlement → Core → Audit/Notifications) generalizes to a second vertical with **zero** further Core or Platform changes — not even the two small additive ones Restaurant needed (`updateOrderLineQuantity`/`removeOrderLine`, `listBranches`), since those already exist and Retail reuses them as-is.

## 2. Scope

Select branch; browse menu/catalog (items are `InventoryItem` references, same as Restaurant); build a cart client-side; checkout (creates a Core order from the full cart in one call); review totals; add/update-quantity/remove lines on a still-pending sale; complete or void; sale history.

**Explicitly out of scope (per approval):** payment/tender recording, any other unrelated retail feature (discounts, coupons, receipts, barcode scanning), and Phase 4.2 (Loyalty).

## 3. Why Retail, and Why It's the Minimal Case

Retail was the vertical originally scoped in the very first Phase 3 planning draft, before Restaurant was chosen instead — already analyzed in detail, lowest new-design risk. With payment/tender excluded, Retail turns out to need **no App-owned data at all**: a plain retail sale is fully described by fields Core's own `Order`/`OrderLine` already carry (branchId, lines, totals, status). This makes Retail a stronger, simpler proof of "zero duplicated logic" than Restaurant, which still needed its own `orderMeta` (order type, table, guest count, kitchen note) for fields Core structurally cannot own.

## 4. Architecture

```
Core (order-engine, inventory-engine, audit-logs, notifications, companies)
   ▲  called directly, via Core's own exported service functions only
Platform (app-installs, licenses)         — unchanged, untouched this phase
   ▲
App Registry (pure data catalog)          — one more registerApp() call, no field/type change
   ▲
Apps/retail (domain, application, actions, components, routes)   — new
   ▲
Settings + Next.js route layer            — routeKey → Component map gains one entry
```

Retail imports Core directly (`@/core`) and nothing else — no Platform, no Connectors, pinned by dedicated `tests/architecture/import-boundaries.test.ts` fixtures (mirroring Restaurant's).

## 5. App Registration & Dynamic Routing

`src/apps/retail/manifest.ts` registers `{ id: "retail", displayName: "Retail", icon: "shopping-bag", routeKey: "retail" }` — no `AppManifest` shape change (Phase 3 already made `routeKey` the field every App uses). `src/app-registry/registry.ts` gains one more `registerApp(retailManifest)` call, alongside Restaurant's. `app-roots.ts` gains one more map entry, `retail: RetailAppRoot`. Nothing about the routeKey → Component mechanism itself changed.

## 6. Core-Owned vs. Retail-Owned Data

**Core owns everything**, unchanged: order existence, lines, quantities, prices, totals, status, timestamps, branchId, inventory movement.

**Retail owns:** nothing. No Firestore collection, no domain type beyond a plain input shape (`CreateSaleParams`: `draftId`, `branchId`, `lines`) used only to call Core's `createOrder`. No `application/*.repository.ts` exists in `src/apps/retail` (unlike Restaurant, which has `order-meta.repository.ts`) — there is nothing for it to read or write.

## 7. Idempotency

Reused exactly as Phase 3 built it, with no changes: `sale.service.ts`'s `createSale` calls `createOrder(companyId, { branchId, appId: "retail", lines }, { idempotencyKey: draftId })`. `draftId` is minted client-side once per checkout attempt (`ItemBrowser.tsx`) and reused across any retry of that same submission. Because Retail has no second write to make atomic with Core's, there is no repair path and no App-owned audit action — Core's own idempotency guarantee is the entire story here, unlike Restaurant where a second (metadata) write could lag behind Core's and need deterministic repair.

A concurrency test (`sale.service.emulator.test.ts`) fires two simultaneous `createSale` calls sharing a `draftId` and asserts exactly one `orders` document exists afterward, mirroring Phase 3's own concurrency tests.

## 8. Order Lifecycle

`createSale` (cart, built entirely client-side, submitted as one call with every line — unlike Restaurant's one-item-at-a-time `createTicket`, since a retail cart's contents are all known before ever touching Core) → `addLine` / `updateLineQuantity` / `removeLine` (Core, called directly, for adjustments after checkout) → `completeSale` / `voidSale` (Core). "Resume a pending sale" lists Core's own pending orders for the branch directly (`listOrdersForBranch`, filtered to `status === "pending"`) — no App-owned list to join against.

## 9. Authorization

Identical to Restaurant, zero new capabilities: view items → `inventory.view`; create sale / modify lines → `orders.create`; complete → `orders.complete`; void → `orders.void`; view history → `orders.view`.

## 10. Audit & Notifications

No Retail-owned audit vocabulary exists (nothing for Retail to audit that Core doesn't already audit atomically via `order.created`/`order.lineAdded`/`order.lineQuantityUpdated`/`order.lineRemoved`/`order.completed`/`order.voided`). Notification: sale voided only (to other Owners/Managers, excluding the actor), the same structural mirror of Restaurant's own void-notification pattern, reusing `listCompanyMembers` + `createNotification`. No notification on routine checkout/completion.

## 11. Firestore

No changes. No new collection, no new rule, no new index — Retail reads/writes exclusively through Core's existing, already-rule-protected `orders`/`orders/{orderId}/lines` collections.

## 12. UI

`ItemBrowser` (branch + item picker, client-side cart, checkout) → `SalePanel` (pending-sale line adjustments, complete/void) → `SaleHistory` (list). Mounted at `/{companyId}/apps/retail`, `/sale/:orderId`, `/history` via the same slug-dispatch pattern `RestaurantAppRoot` established. History and the pending-sales list are scoped to the first available branch (`listBranches`, reused as-is from Phase 3) — a documented simplification for this phase, not a Core limitation (`listOrdersForBranch` already accepts any branchId; a branch switcher for history is a Backlog item, not built now).

## 13. Testing

Unit tests (mocked `@/core`) for `sale.service.ts` and `actions.ts`. Emulator tests against the real Firestore Emulator: sale creation, the required concurrency test, line add/update/remove, complete (with stock deduction), void, and history/pending-sale listing. Architecture tests: import-boundary pins for `apps/retail` (mirroring Restaurant's); the existing `apps-ui-no-firestore.test.ts` and `app-registry-no-react.test.ts` already scan every App generically, so Retail is covered by them with no changes.

## 14. Backlog (explicitly not built this phase)

- Phase 4.2 Loyalty app.
- Payment/tender recording for Retail.
- A branch switcher for Retail's history/pending-sales views (currently scoped to the first branch).
- A known, pre-existing limitation observed (not introduced or fixed this phase, and Restaurant's code was not touched per this phase's explicit instructions): `apps/restaurant`'s `listOrderHistory` does not pre-filter by branch before calling Core's `getOrder`, so a branch-scoped member (non-empty `branchIds`) would hit a thrown `BranchAccessDeniedError` instead of a filtered list if any history entry belongs to a branch outside their scope. Flagged here for a future bug-fix phase; Retail's own `listSaleHistory` does not have this issue, since it queries Core's already branch-scoped `listOrdersForBranch` directly rather than joining across an App-owned collection.

## 15. Estimated Files (actual)

New: ~13 (`manifest.ts`, `domain/sale.types.ts`, `application/sale.service.ts` + unit + emulator tests, `actions.ts` + test, `components/{ItemBrowser,SalePanel,SaleHistory}.tsx`, `routes/RetailAppRoot.tsx`, this plan doc). Modified: `app-registry/registry.ts` (+its test), `app-roots.ts`, `tests/architecture/import-boundaries.test.ts`, `docs/{ROADMAP.md,DATABASE.md}`, `apps/README.md`.
