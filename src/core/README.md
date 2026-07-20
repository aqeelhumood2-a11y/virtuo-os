# Core

The permanent, business-agnostic platform.

**Implemented:**
- `auth` (Phase 1B) — Firebase Authentication (email/password), server-side session cookies, CSRF protection, basic rate limiting. Produces only a verified Firebase Auth UID + session; no Firestore data.

**Reserved for later phases:** Users, Companies, Branches, Roles & Permissions, the Inventory Engine, the Order Engine, Audit Logs, and Notifications — see `docs/ROADMAP.md`.

Import-boundary rule: Core must never import from `src/apps` or `src/connectors`.
