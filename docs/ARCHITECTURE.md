# Virtuo OS — System Architecture

Status: **proposed, awaiting approval**. Nothing in this document has been implemented yet except the infrastructure noted in "Current State" below.

## 1. Current State (already built)

- Next.js 16 (App Router, TypeScript, `src/` layout) scaffolded.
- Firebase project `virtuo-os` created and linked (`.firebaserc`, `firebase.json`).
- Cloud Firestore (native mode) live, security rules deployed, verified with a real write/read/delete round trip.
- Firebase Auth and Firebase Storage: pending a one-time console action (Storage needs Blaze billing attached; Auth needs "Get started" clicked) — tracked separately, not part of this roadmap.
- `src/lib/firebase/{client,admin,config}.ts` — SDK bootstrapping, env-var driven, no hardcoded secrets.
- `.env.local` / `.env.example` — config separated from code.

Everything below is the plan for what gets built on top of this foundation.

## 2. Guiding constraints from the spec

- **Core is permanent and business-agnostic.** No vertical logic ever leaks into Core.
- **Apps are installable/removable units.** A company can run with zero, one, or many Apps active.
- **Connectors are isolated.** A connector failing or being removed must never affect Core or Apps.
- **Everything is multi-tenant** at the Company level, with Branches beneath Company.
- **Strongly typed, SOLID, Clean Architecture, no duplicated logic, no hardcoded secrets.**

## 3. Deployment topology decision

The spec describes Core / Apps / Connectors / Settings / Shared / Database as architectural layers. This does **not** require a multi-repo or multi-deployable monorepo on day one — splitting into separately-deployed packages before there's a reason to (separate teams, separate release cadences, separate scaling needs) would be premature and would slow every phase down.

**Decision:** build this as a single Next.js application with the Core/Apps/Connectors/Settings/Shared boundaries enforced as **folder-level module boundaries** (see `FOLDER_STRUCTURE.md`), with import-boundary lint rules preventing Apps from reaching into each other and preventing Core from importing anything vertical-specific.

**Revisit point:** if/when a specific App or Connector needs an independent deploy/release cycle (e.g. a heavy AI Assistant worker, or a connector that needs its own runtime), extract it into a Turborepo package at that time. This is called out explicitly in the roadmap (Phase 8) rather than done speculatively now.

## 4. Layer responsibilities

### Core (permanent)
Owns identity, tenancy, RBAC, and the two cross-industry business primitives every vertical needs: Inventory and Orders. Structured with light Clean-Architecture layering (`domain` / `application` / `infrastructure`) **only** where that separation earns its keep — the Inventory Engine and Order Engine, which have real business rules and multiple consumers. Simpler CRUD-only modules (Users, Companies, Branches) stay flat to avoid ceremony with no payoff.

- `auth` — session handling, custom-claims sync, provider config (email/password now; Google/Microsoft/Apple are additive later, same interface).
- `users`, `companies`, `branches` — tenancy tree.
- `roles-permissions` — the capability matrix and guard functions every module calls; the single source of truth for "can this actor do this action."
- `licenses` — which Apps/Connectors a Company's plan entitles it to.
- `inventory-engine`, `order-engine` — reusable domain engines. Verticals call these; they never reimplement stock math or order-state machines.
- `audit-logs` — a single write-through logging service every mutation path calls.
- `notifications` — delivery + preferences, channel-agnostic (in-app now, email/SMS/WhatsApp later via the same interface).

### Apps (installable)
Each App is a self-contained folder with a manifest (id, display name, icon, required permissions, routes, owned Firestore collections, install/uninstall hooks). Apps consume Core engines; they do not talk to Firestore for things Core already models (stock, orders) — they extend, they don't duplicate.

### Connectors (isolated integrations)
Each Connector implements one shared `ConnectorContract` (connect / sync / disconnect / webhook handler) and owns its own credential storage, mapping layer, and failure handling. A Connector can be fully removed without touching Core or any App.

### Settings
Per-company configuration surface: branding, locale, which Apps/Connectors are installed, plan/license state. Reads Core (`licenses`, `companies`) and writes install-state, nothing else.

### Shared
Design system (Tailwind-based UI kit), generic hooks/utils/types used across every layer above. No business logic lives here.

## 5. Auth & permissions model

- Firebase Auth handles identity only. Email/Password at launch; Google/Microsoft/Apple are additive provider configs against the same session layer later — not a rewrite.
- A user can belong to **multiple companies** (e.g. a consultant or multi-brand owner), each with its own role. This ranks out storing the full role map in custom claims for every user (claims are capped at ~1000 bytes and don't scale to "many companies"). Instead:
  - Custom claims carry only `{ superAdmin?: boolean }` plus a small cache of the user's **currently active** company + role, refreshed on company switch.
  - The authoritative role record lives in Firestore (`companies/{companyId}/memberships/{userId}`) and is what Firestore Security Rules check via a `get()` on the membership doc — this is the source of truth, claims are just a fast-path cache for UI.
- Roles (from spec, fixed hierarchy): **Super Admin → Company Owner → Manager → Supervisor → Employee.**
- Permissions are capability-based (`inventory.write`, `orders.void`, `users.manage`, `settings.manage`, `apps.install`, `connectors.manage`, ...), with each role granted a default capability set. Per-user overrides are a Phase 1 data-model allowance (a field on the membership doc) even if the UI to edit overrides ships later — this avoids a schema migration when that UI is built.

## 6. Security posture

- Firestore Security Rules are the enforcement boundary, not a formality — every collection's rule is derived directly from the capability matrix in `core/roles-permissions`, so there is one definition of "who can do what," expressed twice (server-side guard + Firestore rule) but sourced from one matrix document to prevent drift.
- All writes that matter (inventory adjustments, order status changes, user/role changes, app installs, connector config) go through server-side logic (Server Actions / Route Handlers using the Admin SDK), not raw client SDK writes — the client SDK is used for reads/realtime subscriptions and Auth only.
- No secret ever ships in a client bundle: connector credentials, service-account keys, and API secrets are server-only env vars, validated at startup (fail fast, not silent `undefined`).

## 7. Decisions locked in with you

- **Vertical priority is deferred**, not assumed: Phase 1 builds the entire Core — including Inventory and Order Engines — with zero vertical bias, and the first App to build is chosen at the start of Phase 3, once there's real Core + App infrastructure to build it against.
- **Auth providers:** Email/Password only for Phase 1. Google/Microsoft/Apple are added later, each as an additive provider config, only when needed — not stubbed speculatively now.
- **Hosting:** Vercel, per the spec. Firebase is backend-only (Auth/Firestore/Storage).

See `ROADMAP.md` for how this plays out phase by phase.
