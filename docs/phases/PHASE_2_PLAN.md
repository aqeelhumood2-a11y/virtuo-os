# Phase 2 — App, Platform & Connector Infrastructure: Implementation Plan

Status: **approved, implemented.** This document consolidates three rounds of revision (renaming `apps-registry` → `app-registry`, extracting a new `platform` layer so Core never learns that plans/licenses/installed-Apps/Connectors exist, and separating Platform's business logic from Settings' Server Actions) into the single plan actually built.

## 1. Goals

Prove the *mechanism*, not a product (per `docs/ROADMAP.md`'s own Milestone 2 framing):
- A company's Owner can install/uninstall an App against license entitlement, and connect/disconnect the one stub Connector.
- A Super Admin can force-toggle an App for any company, bypassing entitlement.
- Core ends Phase 2 with **zero awareness** that plans, subscriptions, licenses, installed Apps, or Connectors exist as concepts.
- Every install/connect mutation is capability-gated and audit-logged using the exact primitives 1D/1G already established — no new authorization idiom, no new logging idiom.
- Explicitly out of scope: real vertical business logic (Phase 3), real external connectors (Phase 5), self-serve billing (unscheduled).

## 2. Architecture Overview

Five top-level layers, each independently testable:

```
core/            permanent, business-agnostic. Never imports platform/apps/connectors/app-registry.
platform/        commercial/tenant-activation business logic ONLY (repositories + services, no UI).
                 Imports core, app-registry, connectors. Never imports apps or settings.
app-registry/    pure, zero-dependency catalog: manifests, registration, discovery, route resolution.
connectors/      pure adapters: validate -> normalize -> return. Only platform/connector-connections
                 may import this module.
apps/            real vertical implementations (empty until Phase 3).
settings/        Server Actions, forms, pages only -- calls into platform's services.
src/app/**       Next.js routing, the one unrestricted composition root.
```

**The Core/Platform boundary contract:** two additive mechanisms let Platform reuse Core's logging/RBAC *machinery* without Core importing Platform's *vocabulary*:
- `core/audit-logs`' `writeAuditInTransaction<TAction, TTargetType>` is generic, defaulting to Core's own closed `AuditAction`/`AuditTargetType`. Every existing Core call site is unaffected. Platform defines its own closed unions (`AppInstallAuditAction`, `ConnectorConnectionAuditAction`) and supplies them as explicit type arguments — full compile-time exhaustiveness, zero import from Platform into Core. `AuditLogEntry.action`/`.targetType` (the read side) are widened to `string`, honestly reflecting a log written by more than one layer.
- Platform owns its **own** capability system (`PlatformCapability`, `PLATFORM_ROLE_CAPABILITIES`, `requirePlatformCapability`) in `platform/shared/require-platform-capability.ts`, reusing only Core's `Role` type and `requireCompanyMembership()` (tenancy primitives). `core/roles-permissions`' `Capability`/`ROLE_CAPABILITIES` gain **zero** new entries.
- Reserved, not built: if a Core primitive ever needs to ask Platform something, the rule is an injected function parameter (a port), never a direct import. No Core function needs this yet.

## 3. Features Included

1. **`platform/licenses`** — read-only entitlement: `getCompanyLicense`, `isAppEntitled`, `isConnectorEntitled`. No mutation surface (license docs are ops/SuperAdmin-provisioned).
2. **`platform/app-installs`** — `*.repository.ts` (reads: `isAppInstalled`, `listInstalledApps`) + `*.service.ts` (business rules: `installApp`, `uninstallApp`, `forceToggleApp` — capability/entitlement/catalog checks, the transactional write, the audit entry, notifications to other Owners/Managers).
3. **`platform/connector-connections`** — same split: `connectConnector`, `disconnectConnector`, `handleWebhook`.
4. **`app-registry`** — pure catalog: `AppManifest`, `registerApp`/`getRegisteredApps`/`getAppManifest`, and `resolveAppRoute(appId, isInstalled)` — a pure function taking install status as an input.
5. **`connectors`** — `ConnectorContract` (connect/disconnect/sync/onWebhook) + registry + the `custom-api` stub (zero Firestore, zero Core/Platform import).
6. **`core/companies/company-settings.ts`** — `companies/{companyId}/settings/branding`, a new subcollection (not a `Company` field), reusing the existing `company.update` capability.
7. **Settings UI** (`src/settings/`) — Apps tab, Connectors tab, Branding tab, each a thin Server-Action wrapper around Platform/Core.
8. **Super Admin App override** — `requireSuperAdmin()` (new, in `core/roles-permissions/guard.ts`, reusing the existing `isSuperAdmin()` predicate), consumed only by the co-located `admin/apps` route's Server Action.

## 4. Folder Structure

```
src/
├── platform/
│   ├── licenses/{license.types,license.repository,index}.ts
│   ├── app-installs/{app-install.types,app-install.repository,app-install.service,index}.ts
│   ├── connector-connections/{connector-connection.types,connector-connection.repository,connector-connection.service,index}.ts
│   ├── shared/require-platform-capability.ts
│   └── index.ts
├── app-registry/{app-manifest.types,registry,resolve-route,index}.ts
├── connectors/{connector-contract.types,registry,index}.ts, custom-api/connector.ts
├── core/companies/{company-settings.types,company-settings}.ts   # new files; actions.ts gains updateBrandingAction
├── settings/
│   ├── apps-management/{AppsList.tsx,actions.ts,page.tsx}
│   ├── connectors-management/{ConnectorsList.tsx,actions.ts,page.tsx}
│   └── branding/{BrandingForm.tsx,page.tsx}
└── app/
    ├── (dashboard)/[companyId]/
    │   ├── apps/[appId]/[[...slug]]/page.tsx
    │   ├── settings/[[...slug]]/page.tsx
    │   └── admin/apps/{page.tsx,actions.ts,ForceToggleList.tsx}
    └── api/webhooks/[connectorId]/route.ts

tests/
├── security-rules/platform.test.ts
└── architecture/{import-boundaries.test.ts (extended), platform-no-server-actions.test.ts (new)}
```

## 5. Data Flow

**Install:** Settings form → `settings/apps-management/actions.ts`'s `installAppAction` (CSRF + parse) → `platform/app-installs.installApp(companyId, appId)` [service: `requirePlatformCapability(companyId, "apps.install")` → `app-registry.getAppManifest(appId)` catalog check → `platform/licenses.isAppEntitled` → one transaction: write `companies/{companyId}/apps/{appId}`, `writeAuditInTransaction`, notify other Owners/Managers] → Server Action maps result/error → `revalidatePath`.

**Force-toggle:** `admin/apps/actions.ts`'s `forceToggleAppAction` → `requireSuperAdmin()` [Core] → same `platform/app-installs` service, `forceToggleApp`, bypassing the capability and entitlement checks.

**Mount an installed App:** `[companyId]/apps/[appId]/...` → `requireCompanyMembership` [Core] → `platform/app-installs.isAppInstalled` → `app-registry.resolveAppRoute(appId, installed)` [pure] → renders the manifest or "not installed."

**Connect/disconnect:** mirrors install, through `platform/connector-connections`, calling the pure connector's `connect()`/`disconnect()` and persisting the result.

**Webhook:** `POST /api/webhooks/[connectorId]` (thin shell) → `platform/connector-connections.handleWebhook(connectorId, rawPayload)` → looks up the pure contract, calls `onWebhook()`. Not company-scoped (no companyId in the route); no Core mutation and no audit entry in Phase 2 — real per-company sync wiring is Phase 5's job (see §11 remaining debt).

## 6. APIs

See `core/README.md`'s Phase 2 section and each module's own `index.ts` barrel for the full exported surface. Key point: `platform/**`'s `*.service.ts` files are plain async functions — no `"use server"`, no `FormData`/`prevState` signature — verified permanently by `tests/architecture/platform-no-server-actions.test.ts`. Every Server Action lives in `settings/*/actions.ts` or (for the Super-Admin-only action) co-located with the `admin/apps` route.

## 7. Firestore Changes

```
companies/{companyId}/licenses/{licenseId}      # doc ID "default"; entitlement only
  plan, entitledApps: string[], entitledConnectors: string[], seats, renewsAt

companies/{companyId}/apps/{appId}              # SOLE source of truth for install state
  enabled, installedAt, config

companies/{companyId}/connectors/{connectorId}
  status, lastSyncAt, credentialRef?, config     # credentials never stored, only a pointer

companies/{companyId}/settings/branding          # Core-owned, not a Company field
  logoUrl?, primaryColor?, updatedAt
```
No new indexes: every new query is a single-doc read by ID or an unfiltered/single-equality-filter list.

## 8. Security Model

- **Core's `Capability`/`ROLE_CAPABILITIES` are untouched.** Platform owns `PlatformCapability` (`apps.view`/`apps.install`/`connectors.view`/`connectors.manage`/`licenses.view`) and its own `PLATFORM_ROLE_CAPABILITIES` (Owner: all five; Manager: the three view-tier ones; Supervisor/Employee: none), checked via `requirePlatformCapability`.
- `requireSuperAdmin()` — Core's first Super Admin *write* path (every prior use was read-only), scoped to exactly one action.
- Firestore rules: every write to `licenses`/`apps`/`connectors`/`settings` is `if false` (Admin-SDK-only). Reads: `licenses` gated by a new, **separate** `hasPlatformCapability(companyId, 'licenses.view')` rules helper (never merged with Core's `roleCapabilities()`); `apps`/`connectors`/`settings` gated by plain `isActiveMember()` (same low-sensitivity tier as `branches`).
- Secrets: `connectors/{connectorId}.credentialRef` is an opaque pointer only, never a raw credential.

## 9. Testing Strategy

- Unit: every Platform repository/service (mocked Firestore + mocked collaborators), the pure `app-registry`/`connectors` modules (no mocks needed), every Settings Server Action (CSRF/parsing/error-mapping), `requireSuperAdmin`/`hasPlatformCapability`.
- Emulator: install/uninstall/force-toggle atomicity with audit + notifications; connector connect/disconnect atomicity; branding round-trip — all against real Firestore transactions.
- Security rules: own unique project ID (`demo-rules-test-platform`) covering `licenses`/`apps`/`connectors`/`settings` read-gating and universal write denial.
- Architecture: extended `import-boundaries.test.ts` (new zones for Platform/App Registry/Connectors/Settings/Apps) plus a new static check (`platform-no-server-actions.test.ts`) that Platform never regresses into containing a Server Action.

## 10. Dependency Rules (permanent project rule)

```
Core
 ▲  Platform depends on Core.
Platform
 ▲  App Registry has zero runtime dependencies (one narrow, compile-time-only
 │  exception once Phase 3 registers a real App's manifest). Platform, Apps,
 │  and Settings all depend on App Registry; it depends on none of them.
App Registry
 ▲  Apps depend on Core and App Registry (their own manifest). Apps do not
 │  depend on Platform, Connectors, or Settings.
Apps
 ▲  Settings depends on Core, Platform, and App Registry. Settings does not
 │  depend on Apps, and does not import Connectors directly.
Settings
 ▲  Next.js Routes may depend on everything above (the one unrestricted
 │  composition root).
Next.js Routes

Connectors — isolated entirely: depends on nothing; only
platform/connector-connections may import it.
```
Enforced today by `eslint.config.mjs`'s `import/no-restricted-paths` zones, permanently verified by `tests/architecture/import-boundaries.test.ts`.

## 11. Remaining Technical Debt

- The webhook route (`/api/webhooks/[connectorId]`) is not company-scoped and performs no Core mutation or persistence beyond calling the pure connector — real per-company sync wiring (resolving which company a webhook belongs to, writing inventory/order mutations from its normalized payload) is deferred to Phase 5, where it would be orchestrated by `platform/connector-connections`, not the connector itself.
- `requirePlatformCapability`/`requireSuperAdmin` derive the acting user from the current HTTP request's session cookie. A true CLI tool or background job has no such cookie; making Platform's services reusable in that context is a known future extension, not solved here (Phase 2's only real caller is the Settings UI, which has a valid session).
- License provisioning has no in-app mutation path — ops/SuperAdmin-side only, until a real billing/plan-purchase phase is scheduled.
- "Only `platform/connector-connections` may import `connectors/`" is documented as a permanent rule but not fully mechanically enforced against `settings/`/`src/app/**` (ESLint's `no-restricted-paths` can't cleanly express "only this one path may import X"); Phase 2's actual code never creates such an import, but a stricter custom lint rule is a candidate follow-up.
- No real vertical App or real external Connector exists yet — by design, per Milestone 2 ("proves the platform, not a product").
