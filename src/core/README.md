# Core

Reserved for the permanent, business-agnostic platform: Auth, Users, Companies, Branches, Roles & Permissions, the Inventory Engine, the Order Engine, Audit Logs, and Notifications.

Populated starting Phase 1B. Empty in Phase 1A (Foundation) by design — see `docs/ROADMAP.md` and `docs/phases/PHASE_1A_PLAN.md`.

Import-boundary rule: Core must never import from `src/apps` or `src/connectors`.
