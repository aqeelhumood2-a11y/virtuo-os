# Virtuo OS — Development Roadmap

Status: **overall direction approved. Phase 1 is broken into sub-phases 1A–1G below; implementation has not started on any of them.** See `ARCHITECTURE.md`, `FOLDER_STRUCTURE.md`, `DATABASE.md` for the detail behind each phase.

## Decisions locked in

- **Phase 1 builds the complete, business-agnostic Core** — including the Inventory and Order Engines — before any vertical App is chosen. The Core must work identically well for a restaurant, a warehouse, or a pharmacy; no vertical gets to shape it.
- **Which vertical App ships first is deferred** to the start of Phase 3 (App build), decided once Core + App infrastructure exist to build against.
- **Auth providers:** Email/Password only for now. Google/Microsoft/Apple are not stubbed in Phase 1 — added later, each as an additive provider config against the same session layer, only when a real need exists.
- **Hosting:** Vercel, as specified. Firebase remains Auth/Firestore/Storage only.

## Phase 0 — Foundation (done)
- Next.js app scaffolded, Firebase project connected, Firestore live and verified.
- Auth provider setup and Storage bucket provisioning pending your one-time console action (tracked outside this roadmap).

## Phase 1 — Complete Core Platform

Phase 1 is too large to execute as one block, so it is split into seven independently testable sub-phases, 1A → 1G, each gated on explicit approval before the next one starts.

### Sub-phase workflow (applies to every one of 1A–1G)

1. Produce a detailed implementation plan before writing any code: exact files to create/modify, data models, security rules, acceptance criteria.
2. Wait for that plan to be approved.
3. Implement **only** that sub-phase — nothing from a later sub-phase, no vertical logic, no Apps/Connectors.
4. Run lint, type-check, tests, and a production build; all must pass.
5. Commit and push.
6. Stop and provide a review report (what was built, how it was verified, anything deferred or flagged).
7. Wait for approval before starting the next sub-phase.

### Standing architecture rules (apply to all of Phase 1, every sub-phase)

- Core remains completely business-agnostic — no Restaurant/Retail/Coffee Shop/Warehouse/vertical-specific logic anywhere in Phase 1.
- Apps and Connectors are not implemented yet.
- Firebase Admin credentials are never exposed to client code; `NEXT_PUBLIC_*` env vars never carry private/secret values.
- Every query and mutation enforces tenant isolation (`companyId`/`branchId` scoping).
- Client-provided `companyId`, `branchId`, `role`, and `permissions` are never trusted — authorization is always re-checked server-side against the stored membership record.
- No mock or fake production data unless explicitly requested.
- The agreed architecture (`ARCHITECTURE.md`, `FOLDER_STRUCTURE.md`, `DATABASE.md`) is not modified without going back for approval first.

### Phase 1A — Foundation
Tailwind CSS; base `shared/ui` kit; project structure (`src/core`, `src/apps`, `src/connectors`, `src/settings`, `src/shared` scaffolding); shared types; environment-variable validation (fail fast on missing/misconfigured env); ESLint import-boundary rules; CI checks (lint, type-check, test, build on push). No business features, no data models, no Firestore rules — this phase is pure scaffolding and tooling.

### Phase 1B — Authentication and Sessions
Email/password authentication; secure server-side session layer; protected-route middleware; sign in; sign out; password reset; auth error handling; auth tests. Firestore/Auth security rules scoped to exactly what this phase needs (account existence, no company/tenant data model yet).

### Phase 1C — Multi-Tenant Organization Model
`core/users`, `core/companies`, `core/branches`, `core/roles-permissions`'s membership records (data model only, not full RBAC yet — see 1D); company onboarding flow; CRUD operations for all of the above; tenant isolation enforced on every read/write; tests; Firestore rules for these resources.

### Phase 1D — Roles and Permissions
RBAC capability matrix; the five fixed roles (Super Admin, Company Owner, Manager, Supervisor, Employee); server-side authorization guards; UI-level permission guards (hide/disable, never the sole enforcement); tests proving unauthorized access is denied at the server, not just hidden in the UI.

### Phase 1E — Generic Inventory Engine
Generic items; units of measure; stock locations; stock balances; stock movements; adjustments; transfers; counts; immutable movement history; atomic transactions (no partial stock updates); tests and Firestore rules.

### Phase 1F — Generic Order Engine
Generic orders; order lines; status lifecycle; inventory deduction routed through the Inventory Engine (never a direct write to stock); pending-order handling; idempotency (safe to retry a mutation without double-effect); transaction safety; tests and Firestore rules.

### Phase 1G — Audit Logs and Notifications
Audit every mutation from 1B–1F; before/after values captured where safe to do so; actor, company, branch, timestamp, and action recorded on every entry; immutable audit records (append-only, no update/delete); in-app notifications; read/unread state; tests and Firestore rules.

**Milestone 1 (end of 1G):** A user can register, create a company, invite a teammate with an assigned role, and see a role-gated dashboard shell. Inventory items can be created and stock adjusted; Orders can be created and transitioned through their status lifecycle — all through Core APIs, with no vertical UI, every mutation audit-logged, tenant-isolated, and rule-protected. This is the point at which the Core is demonstrably industry-agnostic.

Implementation does not begin on 1A until explicitly approved. Each subsequent sub-phase requires its own explicit approval in turn.

## Phase 2 — App, Platform & Connector Infrastructure (implemented; see `docs/phases/PHASE_2_PLAN.md`)
2.1 `app-registry` (renamed from the originally-sketched `apps-registry`): `AppManifest` type, registration, discovery, pure route resolution -- a catalog only. Per-company install/uninstall state moved to a new `platform` layer (2.4 below), not the registry itself.
2.2 Dynamic routing so an installed App's routes mount under `[companyId]/apps/[appId]`.
2.3 `connectors` registry + shared `ConnectorContract`; one stub connector (Custom API) built purely to prove the interface end-to-end. Connectors are pure adapters -- no Firestore, no Core, no Platform import.
2.4 New `platform` layer (not `core/licenses` as originally sketched -- licensing/subscriptions are a commercial concern Core must never know about): `platform/licenses` (entitlement only), `platform/app-installs` (install state + business logic), `platform/connector-connections` (connection state + business logic).
2.5 `settings` module: Server Actions, forms, and pages only (branding, install/uninstall UI for Apps and Connectors), calling into `platform`'s services -- no business logic of its own.

**Milestone 2:** Super Admin can toggle an App on/off for a company and see it appear/disappear live; a stub connector can be configured and shows a connected status. Still no real vertical business logic — this phase proves the *platform*, not a product.

## Phase 3 — First Vertical App (implemented; see `docs/phases/PHASE_3_PLAN.md`)
3.0 **Restaurant / Food & Beverage (counter-service POS)** chosen as the first vertical -- builds directly on the existing Order and Inventory Engines, and serves as the reference implementation future verticals (Retail, Coffee Shop, Warehouse, Pharmacy, Salon) copy.
3.1 `src/apps/restaurant`: manifest + domain glue (order type, table/reference, guest count, kitchen note -- fields Core structurally cannot own).
3.2 Counter-service UI wired directly to Core's Order Engine (create/add-line/update-quantity/remove-line/complete/void) and Inventory Engine (menu items as `InventoryItem` references) -- zero business logic duplicated outside the App's own layer.
3.3 Screens: menu/branch/order-type selection, ticket (lines, totals, complete/void), order history.
3.4 Two small, necessary Core additions this phase required: a generic, business-agnostic idempotency-key mechanism on `createOrder` (exactly-once order creation under concurrent/duplicate requests, reusable by any future Core mutation) and `updateOrderLineQuantity`/`removeOrderLine` on the Order Engine (the approved scope required them; only `addOrderLine` existed before). A one-field, UI-independent addition to App Registry (`AppManifest.routeKey: string`) and a small additive Core read (`listBranches`) round out the touch-points -- everything else built entirely inside `src/apps/restaurant`.

**Milestone 3:** End-to-end flow — start an order, add/adjust/remove items, complete or void it, see it in history — for Restaurant, with the Order/Inventory Engines requiring no vertical-specific changes (only the generic idempotency and line-mutation capabilities every future vertical will also need).

## Phase 4 — Second Vertical + Loyalty

**4.1 (implemented; see `docs/phases/PHASE_4_PLAN.md`) Second vertical app: Retail** -- a cart/checkout App built entirely on Core's existing Order and Inventory Engines, reusing Phase 3's `createOrder` idempotency mechanism directly. Payment/tender is out of scope, so Retail owns no data Core doesn't already model -- no App-owned Firestore collection, no App-specific audit action, and (unlike Restaurant) no repair path, since there is no second write to ever fall out of sync with Core's own. Proves the architecture needs zero further Core changes for a second vertical.

**4.2 (implemented; see `docs/phases/PHASE_4_2_PLAN.md`) Loyalty app:** points/rewards, reading Core's existing `auditLogs` for `order.completed` entries as its event feed — no new Core event/pub-sub mechanism, proving Apps can react to Core's own record of events without Core, Restaurant, or Retail ever knowing Loyalty exists. Accrual is lazy/on-demand (triggered on app mount for an authorized user, or a manual "Sync Now" action) — no Cloud Functions, scheduler, or background worker. Order-to-member linking is a Loyalty-owned manual attribution step, decoupled entirely from Restaurant's and Retail's own checkout flows (neither is modified). Redemption is out of scope for 4.2.

**Milestone 4:** Two verticals live sharing Core engines with zero duplicated logic; Loyalty auto-accrues from real orders.

## Phase 5 — Real External Connectors (implemented; see `docs/phases/PHASE_5_PLAN.md`)
5.1 Shopify connector (implemented) -- Admin REST API, access-token auth; inbound product catalog sync, outbound completed-order push.
5.2 Square connector (implemented) -- REST API, access-token auth; same inbound/outbound shape as Shopify.
5.3 Odoo (implemented) / SAP / Oracle (not built) -- the roadmap's own priority-order deferral was honored literally: with no business-priority signal for which ERP to build first, Odoo was picked as the one with a single, self-hostable, uniformly-documented API that doesn't require a per-customer enterprise integration contract to reason about. SAP and Oracle remain Backlog until that signal exists -- see `PHASE_5_PLAN.md` §4.

**Milestone 5 (met):** Shopify and Square sync real external data bidirectionally (inbound product catalog, outbound completed-order push); Odoo does the same via JSON-RPC. Credentials are stored in Google Secret Manager, never Firestore. Sync is on-demand ("Sync Now"), not event-driven -- consistent with every prior phase's decision against new background infrastructure.

## Phase 6 — Advanced Apps (implemented; see `docs/phases/PHASE_6_PLAN.md`)
6.1 Kitchen Display (implemented) -- realtime order feed. Required bridging the browser to a real Firebase Auth identity (a new, minimal `mintClientAuthToken` addition to `core/auth`) so the previously-unused client Firestore SDK could subscribe via `onSnapshot`, gated by the existing rules with zero rule changes -- see `PHASE_6_PLAN.md` §3.
6.2 Barcode (implemented) -- scan-to-lookup/scan-to-sell, hooking into the Inventory and Order Engines exactly as Retail does. One small Core addition: an optional `InventoryItem.barcode` field + `getItemByBarcode` read.
6.3 WhatsApp (implemented) -- a second `core/notifications` channel (not a Connector). Mirrors company admins' own notifications to one company-wide WhatsApp number via a lazy, on-demand sync in a new `platform/notification-channels` module, reusing Loyalty's own cursor-walk pattern applied to notifications instead of the audit log -- see `PHASE_6_PLAN.md` §5 for why this differs from the architecture proposal's original sketch (Core cannot import Platform to resolve a per-company credential, so the sync pulls from Core's own durable notification records instead of Core pushing to WhatsApp directly).
6.4 AI Assistant (implemented) -- read-only Q&A/reporting layer over Core data, grounded only in the asking user's own already-capability-gated reads (orders/inventory/stock, and audit log only if the user already has audit.view). A single platform-wide Anthropic API key, not per-company.

**Milestone 6 (met):** Kitchen Display, Barcode, WhatsApp, and AI Assistant are all real, working features on top of the existing Core/Platform/Connector/App architecture, with zero changes to Restaurant, Retail, or Loyalty and zero new Core capabilities (one new Platform capability, `notificationChannels.manage`).

## Phase 7 — Hardening & Scale (implemented; see `docs/phases/PHASE_7_PLAN.md`)
7.1 (implemented) Test coverage: coverage tooling (`@vitest/coverage-v8`), the one real coverage gap found (`core/companies/queries.ts`) closed, and a new Playwright e2e harness (`npm run test:e2e`, wired through the same Firestore/Auth emulators as `test:emulator`) with one golden-path spec (register → onboard → land on `/account` as Owner). Building it surfaced and fixed a real, previously-latent gap: `core/auth/identity-toolkit.ts`'s REST client had no emulator-awareness at all.
7.2 (implemented) Performance: defensive `.limit()` caps on every previously-unbounded Core read (`listItems`/`listOrdersForBranch`/`listStockForBranch`/`listMovementsForBranch`), two new cursor-paginated APIs (`listOrdersPage`/`listMovementsPage`, mirroring `listAuditLogsPage`/`listNotificationsPage`) with new composite indexes, `listBranches()` wrapped in `cache()`, and a bundle audit (no recurrence of the Phase 6 barrel-import bundling bug).
7.3 (implemented) Security: full `firestore.rules`/`storage.rules` review (confirmed every write rule is unconditionally Admin-SDK-only, zero exceptions), `npm audit` run and findings documented (none safely fixable without a major framework version bump), manual code-review checklist. A live penetration test was not performed or claimed — recommended as a follow-up with a dedicated security engagement, not something a code-review pass can self-certify.
7.4 (implemented) Observability: a dependency-free structured JSON logger and error reporter (`shared/observability/`), wired into Next.js's `instrumentation.ts` `onRequestError` hook and `app/global-error.tsx`; a `/api/health` liveness endpoint. No third-party error-tracking/uptime-monitoring *service* is connected (no account/credential exists to wire one in against) — the code exposes a clean extension point for when one is added.
7.5 (deferred) Monorepo extraction — precondition not met: no App or Connector currently needs independent deploys, per the roadmap's own conditional language.

**Milestone 7 (met):** lint/typecheck/779+ unit tests/811 emulator tests/1 e2e test/production build all pass; security rules and dependency posture reviewed and documented; basic observability (structured logs, error reporting, health check) is real and working, with third-party service integration left as a documented, credential-gated follow-up.

---

Everything above is a plan, not code. Phase 1A does not start until you give the go-ahead.
