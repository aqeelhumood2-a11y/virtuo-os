# App Registry

A pure, zero-runtime-dependency catalog: `AppManifest` (the contract every installable App satisfies), `registry.ts` (compile-time registration/discovery), and `resolve-route.ts` (pure route resolution, given install status as an input). Never imports Core, Platform, Apps, or Connectors — see `docs/phases/PHASE_2_PLAN.md` §2/§5.

App Registry owns *only* manifests, registration, discovery, and route resolution. Installed-App state and install/uninstall business logic live in `platform/app-installs`, not here — App Registry is a catalog, never an application manager.

Empty of real registrations until Phase 3 picks the first vertical App (see `docs/ROADMAP.md`).
