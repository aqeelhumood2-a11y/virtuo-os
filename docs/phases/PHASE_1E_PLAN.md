# Phase 1E — Generic Inventory Engine: Implementation Plan

Status: **approved, implemented.**

## 1. Inventory data model

New `core/inventory-engine` module, structured with `domain/` / `application/` / `infrastructure/` layering (`ARCHITECTURE.md` §4, `FOLDER_STRUCTURE.md`) — the one Core module besides the future Order Engine where that separation earns its keep. Three entities, matching `docs/DATABASE.md`'s sketch:
- **InventoryItem** — company-wide catalog entry (`sku`, `name`, `unit`, `category`, `defaultPrice`, `isActive`). Not branch-scoped.
- **Stock** — one doc per `(branch, item)` pair (`quantityOnHand`, `reorderPoint`).
- **InventoryMovement** — append-only ledger entry; the only way `quantityOnHand` ever changes.

## 2. Stock movements

Four actionable types (`receive`, `adjust`, `waste`, `transfer`); `sale` stays reserved for the Order Engine (1F). A "count" is not a fifth type — `recordStockCount()` computes `countedQuantity - quantityOnHand` and writes an `adjust` movement with reason `"count"`; if the delta is zero, nothing is written (no audit noise for a count that just confirms the existing number). Movements are immutable: no update/delete path exists anywhere, including server-side.

## 3. Transactions and concurrency

Every mutation runs inside a single `adminDb.runTransaction()`. The delta is computed **inside** the transaction callback, from the quantity read inside that same transaction — this matters most for `recordStockCount()`, where computing the delta from a read taken *before* the transaction would create a race window a concurrent movement could land in. `assertSufficientStock()` runs before any write; violating it aborts the whole transaction (nothing is written). Concurrent writers on the same stock doc are automatically retried by the Admin SDK against a fresh read, the same mechanism 1C's onboarding transaction relies on — proven directly against the real emulator (two concurrent `receiveStock()` calls on the same doc both land, order-independent).

`transferStock()` reads and writes both branches' stock docs in one transaction (single database, no two-phase commit needed) and writes two `transfer` movements sharing a `transferGroupId` — a negative entry at the source, a positive entry at the destination.

## 4. Multi-branch behavior

Items are global per company; stock is keyed `${branchId}_${itemId}`. Every stock/movement function calls `assertBranchAccess()`, which layers 1C's `hasBranchAccess(membership, branchId)` on top of the capability check — a member whose `branchIds` doesn't include the target branch is denied regardless of role. `transferStock()` requires access to **both** branches.

## 5. Server actions

Per your explicit instruction: **no `"use server"` wrappers, no form-bound Server Actions.** Every function in `core/inventory-engine/application/` is a plain `server-only` async function, called directly (identity is re-derived from `requireCapability()`'s session, never accepted as a parameter). Apps will call these directly once real UI/integration exists (Phase 3+).

## 6. Firestore structure

```
companies/{companyId}/inventoryItems/{itemId}
companies/{companyId}/stock/{branchId}_{itemId}
companies/{companyId}/inventoryMovements/{movementId}
```
No new indexes: `stock`/`inventoryMovements` are only ever queried with one equality filter (`branchId`), served by Firestore's automatic single-field indexes. `listMovementsForBranch()` is the only movement query implemented — a cross-branch per-item history view was deliberately not built (no caller needs it yet), so the `(itemId, createdAt)` composite anticipated in `DATABASE.md` stays undeclared.

## 7. Security model

Two new capabilities: `inventory.view` (all four roles) and `inventory.write` (Owner + Manager, mirroring 1D's default split). Rules: `inventoryItems` read-gated by `isActiveMember`/SuperAdmin (company-wide, no branch scoping needed). `stock`/`inventoryMovements` reads additionally require `hasBranchAccess(companyId, resource.data.branchId)` — a new rules-side function mirroring `core/companies/membership.ts`'s helper of the same name. **All writes stay `allow write: if false`** — per `ARCHITECTURE.md` §6, inventory adjustments go through server-side logic, not capability-gated direct client writes (unlike 1D's `companies` update rule); the multi-document atomicity requirements here couldn't be expressed safely as a rules-only invariant regardless.

## 8. Testing strategy

- Domain: pure math tests for `assertSufficientStock`/`computeCountDelta`, no I/O.
- Application (mocked Admin SDK + mocked `roles-permissions`/`hasBranchAccess`): capability-check ordering, branch-access denial, insufficient-stock rejection, transfer's paired writes and shared `transferGroupId`, count no-op on a zero delta, `ItemNotFoundError`.
- Emulator (real transactions): concurrent `receiveStock` retry with no lost update, real waste rejection leaving quantity unchanged, real transfer atomicity (success and insufficient-stock-abort cases), branch-access denial against real membership data.
- Security rules (real emulator, client SDK): branch-scoped read allow/deny on `stock`/`inventoryMovements`, company-wide read on `inventoryItems`, write always denied, SuperAdmin bypass.

## 9. Acceptance criteria

- `quantityOnHand` never goes negative through any path — proven by both mocked and emulator tests attempting it.
- A transfer's two stock updates and two movement writes are all-or-nothing — proven against the real emulator.
- A member with restricted `branchIds` is denied both reading (rules test) and mutating (application-layer test) another branch's stock.
- No new collection allows a direct client write.
- Lint, typecheck, unit tests, emulator tests, and build all pass.

## 10. Risks

- The rules-side `hasBranchAccess()` is a second, hand-written implementation of the same idea as `core/companies/membership.ts`'s TS function — rules can't import TypeScript, so as with `roleCapabilities()` (1D), the two must be kept in sync by hand if the semantics of branch scoping ever change.
- `listMovementsForBranch()` is unordered (no `createdAt` sort) to avoid needing a composite index before any real caller asks for one — a future ordered/paginated view will need that index added and deployed at that time.
- No invite/App-facing UI consumes any of this yet — 1E is Core-only, proven by tests and direct calls, not by an end-to-end product flow.
- **Found and fixed a jsdom/Firestore-transaction interaction bug in the test harness itself**, while building this phase's concurrency test: two concurrent `adminDb.runTransaction()` calls racing to write the same brand-new document would silently lose an update under this project's default Vitest environment (`jsdom`) — confirmed with a guard-free, `core/inventory-engine`-free probe doing nothing but the transaction itself, which reproducibly lost the race under `jsdom` and reproducibly did not as a plain Node script or under Vitest's `node` environment, against the identical emulator/project/code. `stock.emulator.test.ts` is now pinned to `// @vitest-environment node` (it does no DOM work, so this is free), and its concurrency test's timeout is raised to 20s — under the full 28-file suite's combined CPU contention in this sandbox, two genuine Firestore transactions occasionally needed more than the 5s default. The pre-existing `core/companies/onboarding.test.ts` concurrency test relies on the same transaction-retry mechanism and still runs under the default `jsdom` environment — it was observed to intermittently fail under repeated runs for the same underlying reason, but is untouched here as out of scope for this phase; it should get the same `node`-environment pin when someone next touches that file.
