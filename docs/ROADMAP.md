# Virtuo OS — Development Roadmap

Status: **proposed, awaiting approval to start Phase 1.** See `ARCHITECTURE.md`, `FOLDER_STRUCTURE.md`, `DATABASE.md` for the detail behind each phase below.

## Phase 0 — Foundation (done)
- Next.js app scaffolded, Firebase project connected, Firestore live and verified.
- Auth provider setup and Storage bucket provisioning pending your one-time console action (tracked outside this roadmap).

## Phase 1 — Core Platform Foundations
1.1 Add Tailwind CSS + design tokens; stand up `shared/ui` with the base primitives (Button, Input, Card, Table, Modal, Form field).
1.2 Auth flows: register, login, logout, password reset, protected route middleware, `core/auth` session layer.
1.3 `core/users`, `core/companies`, `core/branches` data models + server-side CRUD.
1.4 `core/roles-permissions`: capability matrix, guard functions, membership repository.
1.5 Company onboarding flow: register → create company → become Owner → create first branch.
1.6 `core/audit-logs`: single write-through logger wired into every mutation path from day one.
1.7 Firestore Security Rules for every Core collection above, derived from the capability matrix.
1.8 ESLint import-boundary rules enforcing the Core/Apps/Connectors folder boundaries.

**Milestone 1:** A user can register, create a company, invite a teammate with an assigned role, and see a role-gated dashboard shell with no vertical features yet. Every action so far is audit-logged and rule-protected.

## Phase 2 — App & Connector Infrastructure
2.1 `apps-registry`: `AppManifest` type, registration, per-company install/uninstall state.
2.2 Dynamic routing so an installed App's routes mount under `[companyId]/apps/[appId]`.
2.3 `connectors` registry + shared `ConnectorContract`; one stub connector (Custom API) built purely to prove the interface end-to-end.
2.4 `core/licenses`: plan → entitled Apps/Connectors.
2.5 `settings` module: branding, install/uninstall UI for Apps and Connectors.

**Milestone 2:** Super Admin can toggle an App on/off for a company and see it appear/disappear live; a stub connector can be configured and shows a connected status. No real vertical business logic yet — this phase proves the *platform*, not a product.

## Phase 3 — Core Business Engines
3.1 `core/inventory-engine`: items, per-branch stock, movements, adjust/receive/transfer use-cases, Clean Architecture layering (domain/application/infrastructure).
3.2 `core/order-engine`: orders, order lines, status state machine, totals calculation.
3.3 `core/notifications`: in-app channel now, interface ready for email/WhatsApp later.

**Milestone 3:** Inventory and Orders exist as fully tested, reusable engines with no vertical UI — verified via internal test harness / admin-only debug screens.

## Phase 4 — First Vertical App
4.1 Build the prioritized vertical's manifest + domain glue (see open question below on which one goes first).
4.2 Vertical UI wired to Order Engine (create/void orders) and Inventory Engine (stock deduction on sale).
4.3 Vertical-specific screens (e.g. POS grid + cart for Retail, or table/menu flow for Restaurant).

**Milestone 4:** End-to-end flow — create a product, sell it through the vertical's UI, stock decrements, order is recorded, everything audit-logged — for exactly one industry.

## Phase 5 — Second Vertical + Loyalty
5.1 Second vertical app (whichever of Restaurant/Retail wasn't built first, or Coffee Shop/Warehouse per your priority).
5.2 Loyalty app: points/rewards, subscribing to Order Engine events — proves Apps can react to Core events without Core knowing Loyalty exists.

**Milestone 5:** Two verticals live sharing Core engines with zero duplicated logic; Loyalty auto-accrues from real orders.

## Phase 6 — Real External Connectors
6.1 Shopify connector (product/order sync).
6.2 Square connector.
6.3 Odoo / SAP / Oracle — implemented in priority order once you tell us which businesses need which first.

**Milestone 6:** At least one connector syncing real external data bidirectionally in production.

## Phase 7 — Advanced Apps
7.1 Kitchen Display (realtime order feed, built on Order Engine's realtime subscriptions).
7.2 Barcode (scan-to-lookup/scan-to-sell, hooking into Inventory Engine).
7.3 WhatsApp (order/notification channel via `core/notifications`).
7.4 AI Assistant (Q&A / reporting layer over Core data).

**Milestone 7:** Feature parity with a typical competitor POS/business platform for at least one fully-featured vertical.

## Phase 8 — Hardening & Scale
8.1 Full automated test coverage (unit, integration, Firestore rules tests, e2e).
8.2 Performance pass: pagination, index tuning, caching, bundle/code-splitting audit.
8.3 Security audit: rules review, dependency audit, pen-test pass.
8.4 Observability: structured logging, error tracking, uptime monitoring.
8.5 Revisit the "single app" decision from `ARCHITECTURE.md` §3 — extract to a monorepo only if a concrete App/Connector now needs independent deploys.

**Milestone 8:** Production launch readiness sign-off.

---

## Open decisions — your call before Phase 1 starts

1. **Which vertical App ships first in Phase 4** — Retail, Restaurant, Coffee Shop, or Warehouse? This determines what the Inventory/Order Engines get battle-tested against first.
2. **Auth providers beyond Email/Password** — build the Google/Microsoft/Apple provider slots now (empty but wired) in Phase 1, or defer entirely until a specific provider is needed?
3. **Hosting target** — spec says Vercel; confirming that's still the deploy target for Phase 1 onward (vs. Firebase Hosting, given Firebase is already the backend).

Everything above is a plan, not code. Nothing in Phase 1 starts until you approve it (and answer the three questions above where they affect scope).
