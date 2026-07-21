# Apps

Installable business-vertical Apps. Phase 3 adds the first one, `restaurant` (see `docs/phases/PHASE_3_PLAN.md`) -- a counter-service order-taking App built entirely on Core's existing Order and Inventory Engines, proving the full Platform chain (App Registry → Platform entitlement → Core → Audit/Notifications) end-to-end.

Each App conforms to `src/app-registry`'s `AppManifest` type (`id`, `displayName`, `icon?`, `routeKey`) and depends on Core's public interface and Shared only. `routeKey` is plain data -- the React component it maps to lives at the Next.js route layer (`src/app/(dashboard)/[companyId]/apps/[appId]/[[...slug]]/app-roots.ts`), never in App Registry itself.

Each App's own internal shape (mirrored by `restaurant`):
- `manifest.ts` -- registers with App Registry (imported once, by `app-registry/registry.ts` itself).
- `domain/` -- the App's own types, never duplicating a Core field.
- `application/` -- `*.repository.ts` (raw Firestore reads/writes to the App's own collections only) and `*.service.ts` (business rules, plain async functions, callable by a future API/CLI/job the same way Platform's services are).
- `actions.ts` -- Server Actions only: CSRF check, zod parse, call the App's own service, map errors, `revalidatePath`.
- `components/` and `routes/` -- UI only, never a Firestore import (enforced by `tests/architecture/apps-ui-no-firestore.test.ts`); call the App's own application-layer services, never Firestore directly.

Import-boundary rules: Apps may depend only on Core's public interface, App Registry (own manifest), and Shared; Apps must not import Connectors or Platform directly; Apps must not import each other's internals.

An App's own Firestore-owned data lives under `companies/{companyId}/apps/{appId}/{collection}` -- nested under the same document Platform's install-state doc (`enabled`/`installedAt`/`config`) already owns for that App, since a Firestore document can carry both its own fields and its own subcollections.
