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

## Phase 2 — App & Connector Infrastructure
2.1 `apps-registry`: `AppManifest` type, registration, per-company install/uninstall state.
2.2 Dynamic routing so an installed App's routes mount under `[companyId]/apps/[appId]`.
2.3 `connectors` registry + shared `ConnectorContract`; one stub connector (Custom API) built purely to prove the interface end-to-end.
2.4 `core/licenses`: plan → entitled Apps/Connectors.
2.5 `settings` module: branding, install/uninstall UI for Apps and Connectors.

**Milestone 2:** Super Admin can toggle an App on/off for a company and see it appear/disappear live; a stub connector can be configured and shows a connected status. Still no real vertical business logic — this phase proves the *platform*, not a product.

## Phase 3 — First Vertical App
3.0 **Decide which vertical goes first** (Retail / Restaurant / Coffee Shop / Warehouse / other) — your call, made with the full Core and App infrastructure already in hand.
3.1 Build the chosen vertical's manifest + domain glue.
3.2 Vertical UI wired to Order Engine (create/void orders) and Inventory Engine (stock deduction on sale) — zero new business logic duplicated outside the vertical's own UI layer.
3.3 Vertical-specific screens.

**Milestone 3:** End-to-end flow — create a product, sell it through the vertical's UI, stock decrements, order is recorded, everything audit-logged — for exactly one industry, proving the Core engines needed no changes to support it.

## Phase 4 — Second Vertical + Loyalty
4.1 Second vertical app.
4.2 Loyalty app: points/rewards, subscribing to Order Engine events — proves Apps can react to Core events without Core knowing Loyalty exists.

**Milestone 4:** Two verticals live sharing Core engines with zero duplicated logic; Loyalty auto-accrues from real orders.

## Phase 5 — Real External Connectors
5.1 Shopify connector (product/order sync).
5.2 Square connector.
5.3 Odoo / SAP / Oracle — implemented in priority order once you tell us which businesses need which first.

**Milestone 5:** At least one connector syncing real external data bidirectionally in production.

## Phase 6 — Advanced Apps
6.1 Kitchen Display (realtime order feed, built on Order Engine's realtime subscriptions).
6.2 Barcode (scan-to-lookup/scan-to-sell, hooking into Inventory Engine).
6.3 WhatsApp (order/notification channel via `core/notifications`).
6.4 AI Assistant (Q&A / reporting layer over Core data).

**Milestone 6:** Feature parity with a typical competitor POS/business platform for at least one fully-featured vertical.

## Phase 7 — Hardening & Scale
7.1 Full automated test coverage (unit, integration, Firestore rules tests, e2e).
7.2 Performance pass: pagination, index tuning, caching, bundle/code-splitting audit.
7.3 Security audit: rules review, dependency audit, pen-test pass.
7.4 Observability: structured logging, error tracking, uptime monitoring.
7.5 Revisit the "single app" decision from `ARCHITECTURE.md` §3 — extract to a monorepo only if a concrete App/Connector now needs independent deploys.

**Milestone 7:** Production launch readiness sign-off.

---

Everything above is a plan, not code. Phase 1A does not start until you give the go-ahead.
