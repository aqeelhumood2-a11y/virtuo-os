# Phase 1C — Multi-Tenant Organization Model: Implementation Plan

Status: **awaiting approval — no code written yet.**

Standing rules carried forward: architecture boundary tests remain part of CI; the client-env/server-env split is unchanged; every new dependency needs a documented justification; Core stays completely business-agnostic; server-side authorization only, client input never trusted.

## 0. Scope calls that need your explicit sign-off

As with 1B's sign-up-scope question, a few boundaries here are genuine judgment calls, not spelled out in the roadmap, and cheaper to confirm now than to unwind later:

1. **Self-onboarding creates exactly one company per user, once.** A user with an existing membership (in any company) cannot run the onboarding flow again to create a second company. Creating *additional* companies as an already-onboarded user, and inviting/adding *other* people to a company, are both explicitly **out of scope** for 1C — 1C only ever produces a single-member company (the creator, as Owner). Team invitations are a natural feature for whenever 1D's roles UI or a dedicated "Team" surface gets built. Tell me if you want multi-company creation or invites pulled into 1C instead.
2. **No hard deletes.** Companies and branches are only ever soft-deactivated (`status`/`isActive` flags), never removed as Firestore documents, in 1C. Justification and failure-mode handling in §7.
3. **New test infrastructure proposed:** the Firebase **Firestore Emulator** plus Google's **`@firebase/rules-unit-testing`** package (devDependency) to actually exercise the onboarding transaction and the security rules, rather than mocking Firestore by hand the way 1B mocked the Admin Auth SDK. This is a real addition to the CI pipeline (an emulator process must run alongside the test step) and a new dependency, so it's called out for approval rather than assumed. Detailed in §8.
4. **A signed-in user may edit their own `displayName`** (Users CRUD, self-only) — the one piece of "Users" CRUD that doesn't touch tenancy at all. Confirm this small addition is wanted, or should user-profile editing wait too?

Everything below assumes the answers implied above unless you say otherwise.

## 1. Data model

### `users/{uid}`

Document ID is the Firebase Auth UID itself (not a generated ID) — a 1:1 tie to the identity `getSession()` already produces. **Not company-scoped**: a user can belong to multiple companies via separate membership documents.

```
uid            string   (redundant with doc ID; included for query convenience)
email          string   (copied from the verified session at creation time — a display cache,
                          never the authorization source; Firebase Auth remains authoritative)
displayName    string | null
photoURL       string | null
status         'active' | 'disabled'      (mirrors Firebase Auth; a cache, not authoritative)
onboardedAt    Timestamp | null           (set exactly once, inside the onboarding transaction —
                                            see §2; this is the race-condition guard, not a display field)
createdAt      Timestamp
```

Deliberately **excluded** from the original `docs/DATABASE.md` sketch: `lastLoginAt` (a write on every session creation with no current consumer — premature). Added beyond that sketch: `onboardedAt` (needed for the transactional duplicate-onboarding guard, not present in the original sketch because the onboarding flow hadn't been designed yet).

### `companies/{companyId}`

`companyId` is a Firestore auto-generated ID — never derived from the company name (names are not unique, see §7).

```
name        string
ownerId     string     (uid of the creator/initial Owner — set once at creation, immutable in 1C;
                         NOT the authorization source for "who is Owner" — that is always the
                         membership document's `role` field. ownerId is provenance, not permission.)
status      'active' | 'suspended'   (soft-delete mechanism — see §7)
createdAt   Timestamp
```

Deliberately **excluded**: `industry`, `settings` (branding/locale/timezone/currency). Both were in the original sketch but have zero consumers until Phase 2 (Settings module) — adding them now would be unused scaffolding.

### `companies/{companyId}/branches/{branchId}`

`branchId` is a Firestore auto-generated ID.

```
name        string
isActive    boolean    (soft-delete mechanism, same pattern as company status)
isDefault   boolean    (true only for the branch created during onboarding)
createdAt   Timestamp
```

Deliberately **excluded**: `address`, `timezone`. No consumer until a vertical App needs operational branch details.

### `companies/{companyId}/memberships/{uid}`

**Document ID is the member's `uid`** — this is not just a convention, it is the mechanism that makes "one membership per user per company" a structural guarantee rather than an application-level check (see duplicate-membership handling in §7).

```
uid         string     (redundant with doc ID; required for the collection-group query in §3)
role        'Owner' | 'Manager' | 'Supervisor' | 'Employee'
branchIds   string[]   ([] = access to all branches in this company — an intentionally
                         counter-intuitive convention worth remembering: empty means
                         unrestricted, not "no access")
status      'active'   (only value 1C ever produces; 'invited' | 'disabled' are reserved
                         for whenever an invite flow exists — not built in 1C)
joinedAt    Timestamp
```

Deliberately **excluded**: `capabilityOverrides` (from the original sketch — meaningless until 1D's capability matrix exists to interpret it) and `invitedBy` (no invite flow in 1C, see §0.1).

**`SuperAdmin` is not a membership role.** It's a platform-wide concept (per `ARCHITECTURE.md` §5, represented as a custom claim, not scoped to any company) and is out of scope for 1C entirely — it belongs to 1D alongside the rest of the capability matrix.

### Relationships

- `users/{uid}` ←→ `companies/{companyId}` is many-to-many, realized through `companies/{companyId}/memberships/{uid}` as the join table.
- `companies/{companyId}/branches/{branchId}` is one-to-many, strictly nested (a branch has no meaning outside its company).
- A membership's `branchIds` array references branch IDs that must belong to the *same* company as the membership — never validated across companies because the read path never lets a foreign branchId be resolved against the wrong company (see §5).

### Firestore collection structure (final, for this phase)

```
users/{uid}
companies/{companyId}
companies/{companyId}/branches/{branchId}
companies/{companyId}/memberships/{uid}
```

### Required indexes

1. **Collection-group field override** on `memberships.uid` — enables `collectionGroup('memberships').where('uid', '==', ...)`, the mechanism behind "what companies do I belong to" (see §3). Firestore does not enable collection-group query scope on a field by default; this must be explicitly declared in `firestore.indexes.json`.
2. **Composite, collection group `memberships`:** `(uid ASC, status ASC)` — "my active company memberships."
3. **Composite, `companies/{companyId}/memberships` (per-company scope):** `(status ASC, joinedAt ASC)` — "active members of this company, oldest first."
4. **Composite, `companies/{companyId}/branches` (per-company scope):** `(isActive ASC, createdAt ASC)` — "active branches."

No other indexes are added speculatively — matches `docs/DATABASE.md`'s existing principle of adding indexes as real queries are written, not upfront.

## 2. Company onboarding flow

Preconditions: an authenticated Firebase user (`uid` from `requireSession()` — 1B's DAL, reused unchanged) submits a "Create your company" form (company name only) via a Server Action.

**Exact sequence:**

1. `requireSession()` → `{ uid, email }`. This is the *only* trusted identity input. The company name is the only client-supplied data; nothing else from the client (no uid, no role, no companyId) is ever accepted.
2. CSRF check — reuses 1B's `csrf.ts` double-submit pattern unchanged (onboarding is a state-changing Server Action, same requirement class as the auth actions).
3. Rate limit — reuses 1B's `RateLimiter` interface/`checkRateLimit` unchanged, a new `onboarding` action key.
4. Zod validation of the company name (non-empty, reasonable length) — rejected before any Firestore access.
5. **One Firestore transaction** performs steps 6–9 atomically:
6. `transaction.get(usersDoc(uid))`. If it exists **and** `onboardedAt` is already set → abort the transaction and return "You already belong to a company" (this is the race-condition-safe duplicate-onboarding guard — see §7 for why this specific mechanism, not a query, is used inside a transaction).
7. Upsert `users/{uid}`: `uid`, `email` (from the verified session, never the form), `displayName` defaulted to `null`, `status: 'active'`, `createdAt` (only if new), `onboardedAt: serverTimestamp()`.
8. Create `companies/{companyId}` (ID generated before the transaction via `db.collection('companies').doc()`): `name` (validated form input), `ownerId: uid`, `status: 'active'`, `createdAt: serverTimestamp()`.
9. Create `companies/{companyId}/branches/{branchId}` (ID likewise pre-generated): `name: 'Main'`, `isActive: true`, `isDefault: true`, `createdAt: serverTimestamp()`.
10. Create `companies/{companyId}/memberships/{uid}`: `uid`, `role: 'Owner'`, `branchIds: []` (all branches), `status: 'active'`, `joinedAt: serverTimestamp()`.
11. Commit. Redirect to `/account`, which is extended (not replaced — see below) to additionally show "Company: {name} · Role: Owner · Branch: {branch name}" once a membership exists, still a bare technical placeholder, no business UI.

**"Initial permissions"**, precisely: the only permission-relevant fact 1C establishes is the membership's `role: 'Owner'` value itself. There is no capability matrix to translate that into fine-grained permissions yet (1D). 1C's own authorization (§5/§6) only ever special-cases `'Owner'` vs. "any active member" — nothing finer.

**Transaction and rollback behavior:** a Firestore transaction is all-or-nothing by construction — there is no partial-write state ever visible to any reader. If step 6's guard fails, or any write is rejected, or the commit loses an optimistic-concurrency race (see §7), **nothing** is written: not the user doc, not the company, not the branch, not the membership. No compensating/rollback logic is needed because every write in this operation targets the same database (Firestore) — onboarding never calls the Firebase Auth Admin SDK (the UID already exists from 1B; 1C only ever *reads* it), so there is no cross-service distributed-transaction problem to solve. This is a deliberate design property, not an accident.

## 3. Multi-tenancy model

- **Tenant isolation**: the tenant is the company. Everything below company level is scoped by Firestore path (`companies/{companyId}/...`), not by a field that could be forged — path-based scoping lets Security Rules check `{companyId}` directly from the request path instead of trusting a field value.
- **Company isolation**: a request as `uid` may touch `companies/{companyId}/...` only if `companies/{companyId}/memberships/{uid}` exists with `status == 'active'`. One direct document read (O(1)), both in rules and in server code — never a query, never client-asserted.
- **Branch isolation**: within a company the caller is already verified to belong to, a specific branch operation is further scoped by the caller's own membership `branchIds`: empty array = all branches; otherwise the target branchId must be a member of that array. Because the server always resolves a branch via `companies/{verifiedCompanyId}/branches/{branchId}`, a branchId can never be "borrowed" from a different company — the path itself prevents that confusion, independent of any application-level check.
- **Cross-company protection**: falls out of the path-scoping above by construction — a membership at `companies/{A}/memberships/{uid}` cannot satisfy a rule or a server check anchored at `companies/{B}/...`, because the rule/check is always evaluated against the *same* `{companyId}` as the resource being touched. This isn't a convention that could be violated by a missed check; there is no code path where a company-A membership is ever read while authorizing a company-B request.
- **Membership lookup strategy** — two distinct patterns, two distinct mechanisms:
  1. *"Given a company, am I a member, and what's my role?"* → direct document read at `companies/{companyId}/memberships/{uid}`. Used by both Security Rules and server code. O(1), no index needed beyond the document itself.
  2. *"Given just my uid, what companies do I belong to?"* → the collection-group query `collectionGroup('memberships').where('uid','==',uid).where('status','==','active')`, enabled by the `uid` field + the collection-group index from §1. Used only by server code (e.g., "your companies" listings); not needed by rules for anything in 1C's scope.

## 4. Firestore security rules

One rule block per collection, all built from a small set of shared helper functions (mirroring the "one canonical capability source" principle from `ARCHITECTURE.md` §6) so the logic exists once, not once per collection:

```
function isSignedIn() {
  return request.auth != null;
}

function isSelf(uid) {
  return isSignedIn() && request.auth.uid == uid;
}

function membershipDoc(companyId) {
  return /databases/$(database)/documents/companies/$(companyId)/memberships/$(request.auth.uid);
}

function companyDoc(companyId) {
  return /databases/$(database)/documents/companies/$(companyId);
}

function isActiveMember(companyId) {
  return isSignedIn()
    && exists(membershipDoc(companyId))
    && get(membershipDoc(companyId)).data.status == 'active';
}

function memberRole(companyId) {
  return get(membershipDoc(companyId)).data.role;
}

function isOwner(companyId) {
  return isActiveMember(companyId) && memberRole(companyId) == 'Owner';
}

function companyIsActive(companyId) {
  return get(companyDoc(companyId)).data.status == 'active';
}
```

```
match /users/{uid} {
  // Self-only. No teammate lookup of another user's profile exists in 1C
  // (a "member roster with names" feature, if ever built, would be a
  // deliberate future DTO/projection decision, not a relaxation of this rule).
  allow read: if isSelf(uid);
  // Onboarding's transaction and profile edits both go through the Admin
  // SDK server-side; there is no direct-from-client write path.
  allow write: if false;
}

match /companies/{companyId} {
  // Any active member can read their own company, active or suspended
  // (an Owner needs to see a suspended company to understand its state).
  allow read: if isActiveMember(companyId);
  // Never created directly by a client -- always via the onboarding
  // transaction (Admin SDK).
  allow create: if false;
  // Owner-only, and only the two fields 1C actually lets change.
  allow update: if isOwner(companyId)
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'status']);
  allow delete: if false; // no hard delete in 1C -- see §7

  match /branches/{branchId} {
    allow read: if isActiveMember(companyId);
    // 1C creates exactly one branch, only via the onboarding transaction.
    // No client-side "add branch" UI exists yet in this phase.
    allow write: if false;
  }

  match /memberships/{memberUid} {
    // Any active member can see the roster (role/branchIds), not each
    // other's user-profile documents (see /users/{uid} above).
    allow read: if isActiveMember(companyId);
    // Only ever created by the onboarding transaction in 1C -- no
    // invite/add-member or role-change UI exists yet (see §0.1).
    allow write: if false;
  }
}
```

**Why each rule exists:**
- `users/{uid}` read is self-only because there is no legitimate 1C reason for one user to read another's profile document; it also means a compromised/malicious client can never enumerate other users via Firestore.
- `users/{uid}` write is `false` unconditionally because every legitimate write (onboarding's upsert, a future self-edit of `displayName`) goes through server code using the Admin SDK, which bypasses Security Rules entirely (Admin SDK requests are not subject to rules) — so the rule's job is purely to block *direct client* writes, not to express the real authorization logic (that logic lives server-side, §5).
- `companies/{companyId}` read requires active membership because company existence/name is tenant data, not public.
- `companies/{companyId}` create is `false` because onboarding is the only creation path and it runs server-side (Admin SDK) inside a transaction that client-side rules cannot express (the "check `onboardedAt` on a *different* document" precondition isn't expressible as a per-document Security Rule in a way that's also race-safe).
- `companies/{companyId}` update is Owner-only and field-restricted so a non-Owner member can never rename or suspend the company, and even the Owner cannot rewrite `ownerId`/`createdAt` through this path.
- `companies/{companyId}` delete is `false` because 1C has no hard-delete concept at all (§7).
- `branches` read is member-only (not branchId-scoped) because the branch *document* itself (name, active flag) is low-sensitivity company metadata everyone on the team should see; `branchIds` scoping matters for *operational data* a later phase will nest under a branch, not the branch document's own visibility.
- `branches`/`memberships` write is `false` because 1C's only creation path for either is the onboarding transaction (Admin SDK); no direct-client mutation of either exists yet.

## 5. Server authorization

Every request re-derives all four values server-side; nothing is trusted from the client beyond "here is a companyId/branchId I'd like to act on," which is treated as an unauthenticated *hint* until verified.

- **UID**: unchanged from 1B — exclusively `requireSession()`/`getSession()`, which is exclusively `adminAuth.verifySessionCookie()`. Never a request body/header/param.
- **Company**: a companyId arriving via a URL segment or form field is untrusted. The server always re-derives "does this uid have a membership here" via a direct Admin SDK read of `companies/{companyId}/memberships/{uid}` — never assumed from anything the client asserts, and never cached across requests (only within one request via `cache()`).
- **Branch**: a branchId arriving via the client is likewise untrusted. Once the company is verified, the branchId is checked against the *just-fetched* membership's `branchIds` (empty = all; otherwise must be `in` the array) — and is only ever resolved by reading `companies/{verifiedCompanyId}/branches/{branchId}`, so a branchId can't be silently reinterpreted under the wrong company.
- **Membership**: the single source of truth is the direct read described above. It is fetched once via a proposed DAL function, `requireCompanyMembership(companyId)` (lives in `core/companies/`, mirrors 1B's `requireSession()` shape): calls `requireSession()` first, then reads the membership doc; if missing/inactive, this is a distinct outcome from "not authenticated" — the user *is* signed in, they're just not a member of *this* company — so it does not redirect to `/login`; it redirects to a safe fallback (`/account`) with a "not a member of that company" state, analogous to but distinct from 1B's redirect-to-login. Cached per-request via React's `cache()`, exactly like `getSession()`.

## 6. CRUD operations

| Resource | Op | Who | Notes |
|---|---|---|---|
| User | Create | System only, via onboarding transaction | Never a direct client write |
| User | Read | Self only | No teammate profile lookup in 1C |
| User | Update | Self only, `displayName` only | Pending §0.4 confirmation |
| User | Delete | None | Account deletion is a distinct, cross-cutting concern (companies you own, last-owner situations) — explicitly out of scope, flagged in §10 |
| Company | Create | System only, via onboarding transaction | Never a direct client create |
| Company | Read | Any active member (any status) | |
| Company | Update | Owner only; `name`/`status` only | `status` is the soft-delete mechanism |
| Company | Delete | None (hard delete) | Soft-delete via Update→status is the only "deletion" |
| Branch | Create | System only, via onboarding transaction | No "add another branch" UI in 1C (§0 doesn't list this as required; flagged as a natural near-future addition, not built now) |
| Branch | Read | Any active member of the company | Not branchIds-scoped (see §4) |
| Branch | Update | None in 1C | Renaming/deactivating a branch has no UI yet |
| Branch | Delete | None | Soft-deactivate only, whenever Update exists |
| Membership | Create | System only, via onboarding transaction | No invite/add-member flow in 1C (§0.1) |
| Membership | Read | Any active member of the company | Roster visibility (role/branchIds), not user profiles |
| Membership | Update | None in 1C | Role changes wait for 1D's capability matrix to give them meaning |
| Membership | Delete | None in 1C | "Leave a company" / "remove a member" both deferred |

## 7. Failure scenarios

- **Duplicate company names**: allowed, not prevented. Company names are not unique (globally or per-owner) — `companyId`, never `name`, is the real identifier everywhere. Enforcing name uniqueness would need an extra reservation collection and transaction with no functional requirement driving it; explicitly not built.
- **Duplicate memberships**: prevented two ways — structurally, by using `uid` as the membership document ID (a second "join" is a well-defined overwrite of the same doc, not a new one), and procedurally, by the onboarding transaction's `onboardedAt` guard, which prevents a second onboarding run (and therefore a second membership) from ever being attempted for the same uid via this flow.
- **Deleted users**: 1C has no user-deletion feature. If a Firebase Auth account is removed by some other means (console, future admin tool), `requireSession()` can never again produce that uid — the corresponding `users/{uid}` doc and any memberships referencing it become permanently inert, not corrupted. Acceptable for 1C; no cleanup job is in scope.
- **Deleted companies**: there is no hard delete (§0.2) — only `status: 'suspended'` via the Owner-only Update path. A "deleted" company is always still a real document; rules preserve Owner read access to it (so they can see it's suspended) while `isActiveMember`'s use in future phases would additionally gate on `companyIsActive()` for non-Owner access to anything nested deeper.
- **Orphan branches**: structurally limited in 1C because there is no company hard-delete to orphan a branch *from*. Flagged for the future regardless: Firestore does **not** cascade-delete subcollections when a parent document is deleted — a later phase that adds real company deletion must explicitly (batch-)delete the `branches`/`memberships` subcollections itself, or they become genuinely orphaned (a real Firestore behavior, not a hypothetical).
- **Concurrent onboarding**: two simultaneous onboarding submissions for the same uid both start a transaction reading `users/{uid}`. Firestore's optimistic concurrency control serializes them: the second transaction to attempt to commit sees the first transaction's write (via automatic retry with a fresh read) and finds `onboardedAt` already set, so it aborts cleanly with "you already belong to a company" instead of creating a second company. No custom locking is needed — this is exactly what Firestore transactions guarantee.
- **Partial transaction failures**: impossible by construction — a transaction either fully commits (all four documents) or fully aborts (none of them). A client-observed failure (including a network timeout *after* the server actually committed) is always safe to retry, because retrying re-enters the same guarded transaction and will correctly report "already onboarded" if the original attempt actually succeeded.

## 8. Testing strategy

- **Unit tests** (Vitest, no Firestore involved): Zod validation for the company-name input; the pure "does this membership grant access to branch X" helper (`branchIds.length === 0 || branchIds.includes(branchId)`); the safe-error-mapping convention reused from 1B for any Firestore error surfaced to a user.
- **Integration tests** (new: **Firestore Emulator**, `FIRESTORE_EMULATOR_HOST` pointing the Admin SDK at it): the onboarding transaction end-to-end — asserts all four documents are created together; asserts the duplicate-onboarding guard rejects a second attempt; asserts two concurrent attempts (fired without awaiting each other) result in exactly one company being created and one clean rejection, not a corrupt partial state. This is the first phase where mocking Firestore by hand (1B's approach for Admin Auth) would be too unrealistic to trust — a multi-document transaction's retry/contention behavior is exactly the kind of thing that needs to run against real Firestore semantics.
- **Security rule tests** (new: **`@firebase/rules-unit-testing`**, Google's official package for exactly this, against the same emulator): every rule in §4 gets a positive and a negative case — a member can read their company/branches/memberships; a non-member cannot; an Owner can update `name`/`status`; a non-Owner cannot; nobody can write `users`/`companies`/`branches`/`memberships` directly as a client, regardless of role.
- **Multi-tenant isolation tests** (rule tests + integration tests together): a member of company A, given a valid session, cannot read or write anything under company B by any means available to a client — not the company doc, not its branches, not its memberships — proven by attempting each with company A's authenticated context against company B's paths and asserting denial. A member with non-empty `branchIds` is confirmed unable to be treated as having access to a branch outside that array by the server-side DAL helper (§5), even though branch *document* read itself is member-wide per §4 (the isolation being tested here is the `branchIds` interpretation logic, not document read access).

CI impact: the emulator needs to run as a step before the test step (`firebase emulators:start --only firestore,auth --project virtuo-os &` then wait for the emulator ports, matching the pattern already used for local Firebase tooling). No real Firebase Admin credentials are needed for emulator-backed tests — the emulator accepts any project ID and fake credentials, so this does **not** require adding real secrets to CI, consistent with the environment-separation rule.

## 9. Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run test` (including new emulator-backed integration and rule tests) all pass; `npm run build` succeeds.
2. A first-time signed-in user can create a company through the onboarding form; the transaction produces exactly one `users` doc (with `onboardedAt` set), one `companies` doc, one default `branches` doc (`isDefault: true`), and one `memberships` doc (`role: 'Owner'`, `branchIds: []`) — verified against the emulator, not mocks.
3. Submitting the onboarding form again with the same uid (already onboarded) is rejected with a clear, non-technical error and creates no new documents.
4. Two concurrent onboarding submissions for the same uid result in exactly one company being created.
5. A member of company A cannot read or write any document under company B via Security Rules, proven by rule tests for every collection in §4.
6. Every Security Rule in §4 has both a positive and a negative test case passing against the emulator.
7. No client-side write path exists for `users`, `companies`, `branches`, or `memberships` other than through the server-side onboarding transaction (and, if §0.4 is confirmed, self-only `displayName` updates) — verified by rule tests asserting `allow write: if false` holds for every other case.
8. `/account` shows company/role/branch information once a membership exists, remaining a bare technical placeholder — no fake data, no business UI.
9. No vertical/business-specific logic anywhere in the diff; Core stays business-agnostic.
10. Every new dependency (Firestore Emulator usage, `@firebase/rules-unit-testing`) is declared and justified per the standing rule, not introduced silently.

## 10. Risks

- **Collection-group index deployment is a real operational step.** If `firestore.indexes.json`'s collection-group field override isn't deployed (`firebase deploy --only firestore:indexes`) before the "list my companies" query ships, that query fails at runtime with a Firestore error (which does include a console link to create the missing index, but only after a real user hits it). Needs to be part of the deployment checklist, not just the code.
- **Unbounded growth, no hard delete.** Companies and branches accumulate forever in 1C (soft-delete only). Acceptable now; a future lifecycle/retention phase should revisit this deliberately rather than by default.
- **Transaction contention under pathological retry.** Firestore transactions have a bounded retry count; extremely unlikely but theoretically possible exhaustion (e.g., a double-submitted form racing itself) would surface as a generic error to the user. Mitigated by CSRF (prevents cross-site double-submission) and the rate limiter, not eliminated.
- **`ownerId` vs. membership `role` drift.** `ownerId` is set once and never updated in 1C. A future ownership-transfer feature must remember to either update `ownerId` too or stop treating it as meaningful — flagged now so it isn't a silent inconsistency later.
- **`role` has no enforcement yet beyond `'Owner'`.** Manager/Supervisor/Employee are just labels until 1D's capability matrix exists; nothing in 1C differentiates them. This is intentional but worth stating plainly rather than letting it look like an oversight.
- **New test infrastructure is a real CI change**, not a drop-in addition — the emulator must start reliably in CI before tests run, and a hung/failed emulator start needs a clear failure mode, not a silent hang. Called out in §0.3 for explicit approval rather than assumed.
