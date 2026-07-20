# Virtuo OS — Development Roadmap

Status: **proposed, awaiting approval to start Phase 1.** See `ARCHITECTURE.md`, `FOLDER_STRUCTURE.md`, `DATABASE.md` for the detail behind each phase below.

## Decisions locked in

- **Phase 1 builds the complete, business-agnostic Core** — including the Inventory and Order Engines — before any vertical App is chosen. The Core must work identically well for a restaurant, a warehouse, or a pharmacy; no vertical gets to shape it.
- **Which vertical App ships first is deferred** to the start of Phase 3 (App build), decided once Core + App infrastructure exist to build against.
- **Auth providers:** Email/Password only for now. Google/Microsoft/Apple are not stubbed in Phase 1 — added later, each as an additive provider config against the same session layer, only when a real need exists.
- **Hosting:** Vercel, as specified. Firebase remains Auth/Firestore/Storage only.

## Phase 0 — Foundation (done)
- Next.js app scaffolded, Firebase project connected, Firestore live and verified.
- Auth provider setup and Storage bucket provisioning pending your one-time console action (tracked outside this roadmap).

## Phase 1 — Complete Core Platform
1.1 Add Tailwind CSS + design tokens; stand up `shared/ui` with the base primitives (Button, Input, Card, Table, Modal, Form field).
1.2 Auth flows: register, login, logout, password reset, protected route middleware, `core/auth` session layer (Email/Password only).
1.3 `core/users`, `core/companies`, `core/branches` data models + server-side CRUD.
1.4 `core/roles-permissions`: capability matrix, guard functions, membership repository.
1.5 Company onboarding flow: register → create company → become Owner → create first branch.
1.6 `core/inventory-engine`: items, per-branch stock, movements, adjust/receive/transfer use-cases, Clean Architecture layering (domain/application/infrastructure). Built and tested generically — no vertical assumptions.
1.7 `core/order-engine`: orders, order lines, status state machine, totals calculation. Same generic constraint.
1.8 `core/audit-logs`: single write-through logger wired into every mutation path from day one (users, companies, branches, memberships, inventory, orders).
1.9 `core/notifications`: in-app channel now, interface ready for email/WhatsApp later.
1.10 Firestore Security Rules for every Core collection above, derived from the capability matrix.
1.11 ESLint import-boundary rules enforcing the Core/Apps/Connectors folder boundaries — real from the first commit, not retrofitted.

**Milestone 1:** A user can register, create a company, invite a teammate with an assigned role, and see a role-gated dashboard shell. Inventory items can be created and stock adjusted; Orders can be created and transitioned through their status lifecycle — all through Core APIs, with no vertical UI, fully audit-logged and rule-protected. This is the point at which the Core is demonstrably industry-agnostic.

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

Everything above is a plan, not code. Phase 1 does not start until you give the go-ahead.
