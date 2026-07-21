# App Registry

A pure, zero-runtime-dependency catalog: `AppManifest` (the contract every installable App satisfies), `registry.ts` (compile-time registration/discovery), and `resolve-route.ts` (pure route resolution, given install status as an input). Never imports Core, Platform, or Connectors — see `docs/phases/PHASE_2_PLAN.md` §2/§5.

App Registry owns *only* manifests, registration, discovery, and route resolution. Installed-App state and install/uninstall business logic live in `platform/app-installs`, not here — App Registry is a catalog, never an application manager.

`AppManifest.routeKey` is a plain string, never a `ComponentType`/React import (verified permanently by `tests/architecture/app-registry-no-react.test.ts`) — App Registry stays UI-independent. The routeKey → React component mapping lives at the Next.js route layer (`src/app/(dashboard)/[companyId]/apps/[appId]/[[...slug]]/app-roots.ts`), the one layer already permitted to depend on everything below it. See `docs/phases/PHASE_3_PLAN.md` §9 for the full mechanism.

`registry.ts` registers Phase 3's first real vertical, `restaurant` (imported from `src/apps/restaurant/manifest.ts`) — the one narrow, intentional exception to this module's otherwise zero-dependency status: a registration mechanism inherently references what it registers, the same shape `connectors/registry.ts` uses for its one stub connector. A future App is added the same way.
