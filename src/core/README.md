# Core

The permanent, business-agnostic platform.

**Implemented:**
- `auth` (Phase 1B) — Firebase Authentication (email/password), server-side session cookies, CSRF protection, basic rate limiting. Produces only a verified Firebase Auth UID + session; no Firestore data.
- `companies` (Phase 1C) — the Multi-Tenant Organization Model: the onboarding transaction (Company + default Branch + Owner Membership, atomic), `requireCompanyMembership()` as the single authorization entry point for anything company-scoped, and the membership-lookup helpers (`getMembership`, `listMyCompanies`, `hasBranchAccess`).
- `users` (Phase 1C) — the `users/{uid}` profile document (created only by onboarding's transaction) and a self-only `displayName` update.
- `roles-permissions` (Phase 1D) — the capability matrix (`ROLE_CAPABILITIES`) and the guard functions (`hasCapability`, `requireCapability`, `outranks`, `isSuperAdmin`) every module calls to answer "can this actor do this action." `companies/members-actions.ts` (role changes, deactivation) is the first consumer.
- `inventory-engine` (Phase 1E) — the one Core module with real `domain`/`application`/`infrastructure` layering (per `ARCHITECTURE.md` §4). Items are company-wide; stock is per-branch (`${branchId}_${itemId}` keyed) and gated by `hasBranchAccess()` on top of the `inventory.view`/`inventory.write` capabilities. Every stock mutation (`receiveStock`, `wasteStock`, `adjustStock`, `recordStockCount`, `transferStock`) runs inside a Firestore transaction and writes an immutable `inventoryMovements` entry alongside the stock update — no direct writes to `quantityOnHand` exist anywhere else. Plain server-only functions, not form-bound Server Actions — no UI consumes this yet (see `docs/phases/PHASE_1E_PLAN.md` §5). Also exposes `planStockChange`/`commitStockChangePlan` (1F), a two-phase split of the same transaction body so another engine can process *multiple* items' stock changes in one transaction without violating Firestore's read-before-write rule.
- `order-engine` (Phase 1F) — same layering as Inventory Engine. `pending → completed → voided` lifecycle (`canTransition()` is the single source of truth, and the idempotency guard: re-completing an already-completed order throws rather than double-deducting stock). `completeOrder()`/`voidOrder()` never write to `stock`/`inventoryMovements` directly — they plan and commit every line's stock change through Inventory Engine's `planStockChange`/`commitStockChangePlan`, in the same transaction as the order's own status update. `orders.void` is capability-gated separately from `orders.create`/`orders.complete` (Owner/Manager only vs. all four roles).

**Reserved for later phases:** Audit Logs and Notifications — see `docs/ROADMAP.md`.

Import-boundary rule: Core must never import from `src/apps` or `src/connectors`.
