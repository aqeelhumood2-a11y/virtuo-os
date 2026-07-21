# Apps

Reserved for installable business-vertical Apps. Populated starting Phase 3, once the first vertical is chosen (see `docs/ROADMAP.md`). Empty by design until then -- Phase 2 built the mechanism (`src/app-registry`'s catalog, `src/platform/app-installs`' install state, the dynamic `[companyId]/apps/[appId]` mount route) against an empty registry, so it's fully tested ahead of a real App.

A real App will conform to `src/app-registry`'s `AppManifest` type and depend on Core's public interface and Shared.

Import-boundary rules: Apps may depend only on Core's public interface, App Registry (own manifest), and Shared; Apps must not import Connectors or Platform directly; Apps must not import each other's internals.
