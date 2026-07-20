# Phase 1F — Generic Order Engine: Implementation Plan

Status: **approved, implemented.**

## 1. Order data model

New `core/order-engine` module, same `domain`/`application`/`infrastructure` layering as Inventory Engine (`ARCHITECTURE.md` §4).
- **Order** — `branchId`, `appId` (free-form string tag; no App registry exists until Phase 3), `status`, `customerRef?`, `totals: { subtotal, tax, discount, total }`, `createdBy`.
- **OrderLine** (subcollection) — `branchId` (denormalized from the parent order, same reason `inventoryMovements` carries its own), `itemId`, `itemNameSnapshot`, `quantity`, `unitPrice`, `lineTotal`.

Housekeeping done alongside this: `BranchAccessDeniedError` moved from `inventory-engine/domain/errors.ts` to `core/companies/errors.ts` (it's a general branch-scoping concept, not inventory-specific, and Order Engine needed it too).

## 2. Order lifecycle and state transitions

Three states: `pending → completed → voided`, plus `pending → voided` directly. No transition out of `voided`; no `completed → pending`. `core/order-engine/domain/state-machine.ts`'s `canTransition(from, to)` is the single source of truth, checked inside every transaction before `completeOrder`/`voidOrder` proceed — this is also the idempotency guard: retrying an already-completed order throws `InvalidOrderTransitionError` instead of deducting stock twice. Adding a line is not a status transition — `OrderNotEditableError` is thrown separately whenever the order isn't `pending`.

## 3. Inventory integration

`completeOrder()`/`voidOrder()` never touch `stock`/`inventoryMovements` directly — they call into Inventory Engine's application layer. This required a real refactor beyond what the plan anticipated: `applyStockChangeInTransaction()` (1E) did its own read-then-write for a single item, which is fine for one item but violates Firestore's "all reads before all writes" transaction rule the moment a caller needs to process a *second* item read-then-write in the same transaction (exactly Order Engine's situation — one order can have many lines). Split into two exported primitives:
- `planStockChange(transaction, params)` — reads + validates, returns a `StockChangePlan | null` (no writes).
- `commitStockChangePlan(transaction, plan)` — writes only.

`completeOrder`/`voidOrder` call `planStockChange` for every line first, then `commitStockChangePlan` for every plan, so all reads precede all writes across the whole order regardless of line count. `applyStockChangeInTransaction` (still used by 1E's own single-item functions) is now just `plan` immediately followed by `commit`.

## 4. Pricing and totals

Unchanged from the plan: `computeLineTotal(quantity, unitPrice)`, `computeTotals({ lineTotals, tax, discount })` — pure, no real tax-rate logic.

## 5. Transaction boundaries

- `createOrder` — one transaction: order doc (`status: 'pending'`) + every initial line.
- `addOrderLine` — one transaction: re-reads the order (must be `pending`), re-reads existing lines to recompute totals, writes the new line + updated totals.
- `completeOrder` — one transaction: re-reads the order, checks `canTransition(status, 'completed')`, reads+plans every line's stock change, commits every plan, updates order status. Any line's insufficient stock aborts the entire transaction — no partial fulfillment, no partial stock change.
- `voidOrder` — one transaction: re-reads the order, checks `canTransition(status, 'voided')`; if it was `completed`, plans+commits a positive-delta reversal for every line; always updates status to `voided`.

Every capability/branch-access check happens via a **plain, non-transactional** read of the order first (`requireOrderAccess`) — same pattern 1E used — and the transaction itself re-reads everything fresh, so authorization staleness never affects the atomic mutation.

## 6. Firestore structure

```
companies/{companyId}/orders/{orderId}
companies/{companyId}/orders/{orderId}/lines/{lineId}
```
No new indexes: `listOrdersForBranch()` uses a single `branchId` equality filter, same as 1E's stock/movement queries.

## 7. Security model

Four new capabilities: `orders.view`, `orders.create`, `orders.complete` (all four roles — taking and ringing up orders is frontline work) and `orders.void` (Owner + Manager only, per `ARCHITECTURE.md`'s explicit callout of `orders.void` as its own capability). Rules: `orders`/`orders/lines` reads gated by `hasBranchAccess(companyId, resource.data.branchId)` + SuperAdmin bypass — lines carry their own denormalized `branchId` so no parent lookup is needed. All writes stay `allow write: if false` — Admin-SDK-only, same policy as 1E, since the order-completion/void transactions' cross-document atomicity (order status + every line's stock effect) can't be expressed as a rules-only invariant.

## 8. Testing strategy

- Domain: pure tests for `canTransition` and `computeLineTotal`/`computeTotals` — no I/O.
- Application (mocked Admin SDK + mocked `roles-permissions`/`hasBranchAccess`/`inventory-engine`): capability/branch gating, `OrderNotEditableError` on editing a non-pending order, `InvalidOrderTransitionError` on double-complete and double-void, insufficient-stock propagation, void-reversal delta math.
- Emulator (real transactions, pinned to `// @vitest-environment node` per 1E's discovery): real end-to-end completion deducting real stock and writing a real `sale` movement, real all-or-nothing abort when one line of a multi-line order has insufficient stock, real idempotent-retry safety on an already-completed order, real void-reversal restoring exactly what was deducted, real branch-access denial.
- Security rules: branch-scoped read allow/deny on `orders`/`lines`, write always denied, SuperAdmin bypass — own unique emulator project ID (`demo-rules-test-orders`), per 1E's cross-file-interference fix.

## 9. Acceptance criteria

- Completing a multi-line order deducts stock for every line atomically; retrying is a safe no-op error, never a double deduction.
- Insufficient stock on any line aborts the whole order — proven against the real emulator with a two-line order (one plentiful item, one scarce item).
- Voiding a completed order reverses exactly what was deducted.
- `orders.void` is independently gated from `orders.create`/`orders.complete`.
- No direct client write to `orders` or `lines`.
- Lint, typecheck, unit tests, emulator tests, and build all pass.

## 10. Risks

- `planStockChange`/`commitStockChangePlan` are now part of Inventory Engine's public surface specifically so another engine can compose a multi-item transaction — a caller that plans but forgets to commit (or commits out of order relative to other writes) would silently do nothing or violate the read-before-write rule; there's no compile-time guard against misuse, only the convention documented on the functions themselves.
- Same rules-side/TS-side hand-sync risk as 1D/1E: `hasBranchAccess()` in `firestore.rules` mirrors `core/companies/membership.ts`'s function by hand.
- No invite/App-facing UI consumes any of this yet, per the same Core-is-UI-free stance as 1E.
