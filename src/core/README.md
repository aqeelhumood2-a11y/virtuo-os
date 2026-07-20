# Core

The permanent, business-agnostic platform.

**Implemented:**
- `auth` (Phase 1B) — Firebase Authentication (email/password), server-side session cookies, CSRF protection, basic rate limiting. Produces only a verified Firebase Auth UID + session; no Firestore data.
- `companies` (Phase 1C) — the Multi-Tenant Organization Model: the onboarding transaction (Company + default Branch + Owner Membership, atomic), `requireCompanyMembership()` as the single authorization entry point for anything company-scoped, and the membership-lookup helpers (`getMembership`, `listMyCompanies`, `hasBranchAccess`).
- `users` (Phase 1C) — the `users/{uid}` profile document (created only by onboarding's transaction) and a self-only `displayName` update.
- `roles-permissions` (Phase 1D) — the capability matrix (`ROLE_CAPABILITIES`) and the guard functions (`hasCapability`, `requireCapability`, `outranks`, `isSuperAdmin`) every module calls to answer "can this actor do this action." `companies/members-actions.ts` (role changes, deactivation) is the first consumer.

**Reserved for later phases:** the Inventory Engine, the Order Engine, Audit Logs, and Notifications — see `docs/ROADMAP.md`.

Import-boundary rule: Core must never import from `src/apps` or `src/connectors`.
