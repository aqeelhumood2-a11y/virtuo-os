# Phase 1D — Roles & Permissions: Implementation Plan

Status: **approved, implemented.**

## 1. RBAC architecture

New `core/roles-permissions` module — the single source of truth every other module imports (`ARCHITECTURE.md` §4/§6):
- `types.ts` — `Role`, `Capability` unions. `Role` is canonical here; `companies/types.ts`'s `MembershipRole` is an alias of it (one-directional import, avoids a `types.ts` ↔ `types.ts` cycle).
- `matrix.ts` — `ROLE_CAPABILITIES: Record<Role, Capability[]>` (pure data) and `outranks(actor, target)` (rank comparison for who may act on whom).
- `guard.ts` — `hasCapability()`, `requireCapability(companyId, capability)` (composes on 1C's `requireCompanyMembership`), `isSuperAdmin(session)`.

SuperAdmin is not in the matrix — it's a global bypass, not a membership role (`docs/DATABASE.md`).

## 2. Permission model

Capability-based, namespaced `resource.action`, scoped to what exists today:
`company.view`, `company.update`, `company.suspend`, `branch.view`, `membership.view`, `membership.updateRole`, `membership.deactivate`.

Default grants: **Owner** — all seven. **Manager** — all except `membership.updateRole` and `company.suspend`. **Supervisor / Employee** — the three `*.view` capabilities only.

`Membership` gained an optional `capabilityOverrides?: Capability[]` field (`ARCHITECTURE.md` §5 data-model allowance) — the field exists so no schema migration is needed later, but no guard reads it yet; it has no effect in 1D.

## 3. Role hierarchy

Fixed: `SuperAdmin > Owner > Manager > Supervisor > Employee`. Only `membership.updateRole` (Owner-only) touches role assignment in 1D. `outranks(actor, target)` gates deactivation: Owner may deactivate anyone; a Manager may only deactivate Supervisor/Employee, never an Owner or another Manager, even though Manager holds the `membership.deactivate` capability — capability is necessary but not sufficient there.

## 4. Firestore data changes

No new collections. `Membership` gained the one optional field above. No migration script — existing docs simply lack the field, treated as absent (no overrides).

## 5. Server authorization flow

Every mutating action re-derives the actor's membership from Firestore via `requireCapability()` — never trusts the client or the custom-claims cache. New actions in `core/companies/members-actions.ts`:
- `updateMemberRoleAction` — gated on `membership.updateRole`; rejects if it would leave the target's company with zero active Owners.
- `deactivateMemberAction` — gated on `membership.deactivate`; additionally checked against `outranks()`; also rejects the last-Owner case.

Custom claims (`{ superAdmin?: boolean }`) are decoded onto `AuthSession.superAdmin` in `session.ts` for fast-path UI display only — never an authorization source. Setting the claim itself stays a manual Admin-SDK operation; no self-service "grant SuperAdmin" UI is built (a privilege-escalation surface with no reviewer counterpart).

## 6. Security rules impact

- Added `isSuperAdmin()` helper (`request.auth.token.superAdmin == true`); granted read bypass on `companies`, `branches`, `memberships` for cross-tenant support/ops visibility. Writes are untouched by this — SuperAdmin has no write capability modeled in 1D.
- Replaced the hardcoded `isOwner(companyId)` check on the `companies` update rule with `hasCapability(companyId, 'company.update' | 'company.suspend')`, split by which fields are being changed (`name` needs `company.update`, `status` needs `company.suspend`). The rules-native `roleCapabilities()`/`hasCapability()` functions mirror `core/roles-permissions/matrix.ts` by hand, with a comment on both sides — rules can't import TypeScript, so this is kept in sync manually, not automatically.
- `memberships`/`branches` stay `allow write: if false` — role/deactivation writes remain Admin-SDK-only server actions, unchanged from 1C.

## 7. Migration from the bootstrap Owner

1C's onboarding transaction writes `role: 'Owner'` directly with no capability check (there's nothing to check yet at company creation — the company doesn't exist until that write). 1D adds no data migration for this; instead, the last-active-Owner invariant in `isLastActiveOwner()` (`core/companies/membership.ts`) ensures that bootstrap Owner is governed identically to any Owner assigned later: neither `updateMemberRoleAction` nor `deactivateMemberAction` will ever leave a company with zero active Owners, regardless of whether the Owner being acted on is the original bootstrap Owner or one assigned afterward.

## 8. Testing strategy

- Pure unit tests for `matrix.ts`/`guard.ts` (`hasCapability`, `outranks`, `requireCapability` redirect behavior) — no Firestore.
- Unit tests (mocked Admin SDK) for the new `members-actions.ts` flows and the new `membership.ts` helpers (`listCompanyMembers`, `isLastActiveOwner`, `updateMembershipRole`, `deactivateMembership`).
- Emulator-backed rules tests extending `tests/security-rules/companies.test.ts`: Manager denied updating company `status`, Manager still allowed updating `name`, SuperAdmin read bypass on all three collections.

## 9. Acceptance criteria

- `core/roles-permissions` is the only place capability grants are defined; no module hardcodes a role string check for authorization.
- Every 1D mutation is denied server-side for an unauthorized role even if the UI guard is bypassed (proven by tests calling the action directly, not through a form).
- A company can never end up with zero active Owners via either new action.
- SuperAdmin can read across companies via the deployed rules; cannot write anything new in 1D.
- Lint, typecheck, unit tests, emulator tests, and build all pass.

## 10. Risks

- The rules-side `roleCapabilities()` map is a hand-maintained mirror of `matrix.ts`, not generated from it — a future change to one without the other would silently drift. Documented with a comment on both sides; automatic generation is future work if/when the matrix grows large enough to justify it.
- No invite-a-new-user flow exists yet (a brand-new email has no path into a company's roster) — 1D only manages the role/status of *existing* members. Invite-by-email is a distinct feature, out of scope here, tracked in the roadmap's later milestones.
