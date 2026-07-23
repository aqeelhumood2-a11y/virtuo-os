# Phase 7 — Hardening & Scale (implemented)

Status: **implemented in one pass**, per explicit approval. Unlike every prior phase, Phase 7 had no detailed plan document or per-decision approval before implementation — `docs/ROADMAP.md` sketched it only at a high level (7.1-7.5). The approval explicitly authorized making reasonable, industry-standard decisions on ambiguous technical choices and documenting them here rather than stopping to ask, so this document records those decisions after the fact rather than before, as every prior phase's plan did.

## 1. Scope as approved

From `docs/ROADMAP.md`:
- 7.1 Full automated test coverage (unit, integration, Firestore rules tests, e2e)
- 7.2 Performance pass: pagination, index tuning, caching, bundle/code-splitting audit
- 7.3 Security audit: rules review, dependency audit, pen-test pass
- 7.4 Observability: structured logging, error tracking, uptime monitoring
- 7.5 Revisit the "single app" decision — extract to a monorepo only if a concrete App/Connector now needs independent deploys

## 2. 7.2 — Performance

**Defensive bounds on previously-unbounded reads.** `listItems`, `listStockForBranch`, `listOrdersForBranch`, and `listMovementsForBranch` all called `.get()` on a full company/branch-scoped query with no `.limit()` at all — for `orders` and `inventoryMovements` in particular (append-only, ever-growing collections), this meant a single read's cost was unbounded and grew forever with a company's history. Added `MAX_UNBOUNDED_LIST_SIZE = 500` (`src/lib/firebase/pagination.ts`) and applied it to all four. This is a pure safety net: the functions' signatures and return shapes are unchanged, so no existing caller needed to change.

**New cursor-paginated APIs**, mirroring `core/audit-logs`'s `listAuditLogsPage`/`core/notifications`'s `listNotificationsPage` exactly (`Page<T>`/`PageOptions` from `shared/types`, `applyCursor`/`DEFAULT_PAGE_SIZE` from `lib/firebase/pagination`, newest-first via each write's existing `FieldValue.serverTimestamp() createdAt` field):
- `listOrdersPage(companyId, branchId, opts)` — `core/order-engine/application/orders.ts`
- `listMovementsPage(companyId, branchId, opts)` — `core/inventory-engine/application/stock.ts`

Both are additive (existing bulk functions untouched in signature); neither has a consuming UI yet, matching the existing precedent (`listAuditLogsPage`/`listNotificationsPage` were also added ahead of any UI). Two new composite indexes were required and added to `firestore.indexes.json`: `orders: (branchId ASC, createdAt DESC)` and `inventoryMovements: (branchId ASC, createdAt DESC)` — confirmed against the real Firestore Emulator (not just declared) via a new emulator test per function that seeds several records and cursor-walks two pages.

**Scoping decision, stated plainly:** `listOrdersForBranch`'s five real call sites (Kitchen Display, AI Assistant, Retail, connector sync) were **not** migrated to the paginated API in this pass — doing so safely would mean auditing each caller's actual semantics (does it need "all eligible orders" or just "a recent page?") and risks a regression if done quickly. The defensive cap protects them from unbounded cost in the meantime; migrating individual callers to true pagination is a reasonable next increment, not attempted here.

**Caching.** `core/auth/session.ts`'s `getSession()` and `core/companies/membership.ts`'s `requireCompanyMembership()` were already wrapped in React's `cache()` (request-scoped memoization) from earlier phases — audited and confirmed still correct. Found one real gap: `core/companies/branches.ts`'s `listBranches()` was called from multiple independent Server Components (Restaurant, Retail, AI Assistant) per request but was not memoized — wrapped in `cache()` to match the existing pattern.

**Bundle/code-splitting audit.** Reviewed the build's route output and grepped every Client Component for the barrel-import bundling bug class Phase 6 already found once (`KitchenBoard.tsx` importing a Server Action through `@/core`'s general barrel instead of its own `"use server"` file, which pulled the entire server-only module graph into the browser bundle). No recurrence found. Next.js's App Router route-based code-splitting is automatic and already in effect; no further action taken.

## 3. 7.1 — Test coverage

**Coverage tooling.** Added `@vitest/coverage-v8` and `npm run test:coverage`. Running coverage requires care: plain `vitest run --coverage` skips every `describe.skipIf(!IS_EMULATOR)` emulator-only test file (many, including all of `core/companies/onboarding.test.ts`), which makes coverage look artificially low for files that are actually thoroughly tested — only real signal comes from running coverage through `firebase emulators:exec` (`test:coverage` should be run wrapped that way for an accurate number; this is the same reason `test:emulator` exists as a separate script from `test`).

**Real gap found and closed:** `core/companies/queries.ts` (`getMyCompanySummary`, backing the `/account` page) had zero test coverage under either run — the one genuine, previously-invisible gap in the whole codebase. Added `queries.test.ts` (4 tests: no membership, happy path, missing company doc fallback, missing default branch).

Coverage after this pass (via `firebase emulators:exec ... vitest run --coverage`): **91.6% statements / 78.5% branches / 96.8% functions / 94.0% lines.** Remaining lower-coverage spots are mostly Server Actions' own thin error-message branches in Apps (Restaurant/Retail/Barcode/Kitchen Display/AI Assistant/Loyalty `actions.ts` files, 56-77% branch) and `shared/ui/Modal.tsx` (57%) — these are UI-facing error-path branches around already-tested application-layer logic, not untested business logic. Not chased to 100% in this pass; stated here rather than silently left unexplained.

**e2e harness — the biggest addition.** No e2e testing existed at all before this phase. Added Playwright (`@playwright/test`, using the Chromium already pre-installed in this environment) with `playwright.config.ts` and `npm run test:e2e`, wired through the exact same `firebase emulators:exec` mechanism `test:emulator` already uses — Playwright's `webServer` starts `next dev` as a child process, which inherits `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` from the parent the same way Vitest's emulator tests already do, so the real app under test talks to the emulator with zero e2e-specific code in the app itself.

One golden-path spec (`e2e/onboarding.spec.ts`): register → land on `/account` with no company → click through to `/onboarding` → create a company → land back on `/account` showing "Company: X · Role: Owner". This is deliberately the only e2e spec added — it proves the harness is real end-to-end (real browser, real Next.js server, real Firestore/Auth emulators, nothing mocked), and broader per-App e2e coverage is a reasonable next increment on top of it, not attempted here.

**A real bug this e2e spec found and fixed:** building it surfaced that `core/auth/identity-toolkit.ts` (the hand-written REST client wrapping Firebase's Identity Toolkit API for sign-up/sign-in/password-reset) had **no emulator-awareness at all** — its base URL was hardcoded to `https://identitytoolkit.googleapis.com`, unlike every other Firebase Auth touch point in the codebase (`adminAuth`, the client SDK), which auto-detect `FIREBASE_AUTH_EMULATOR_HOST`. This had never been exercised before: every prior unit test mocked `identityToolkitSignUp` directly, and every prior emulator test used the Admin SDK's `adminAuth`, never this REST path. Concretely, this meant an end-to-end test of sign-up/sign-in — had one existed — would have called **real, production Firebase Auth** using `.env.local`'s real API key, not the local emulator.

Fixed by making `IDENTITY_TOOLKIT_BASE_URL` conditional on `process.env.FIREBASE_AUTH_EMULATOR_HOST`, redirecting to the Auth Emulator's own documented REST path (`http://{host}/identitytoolkit.googleapis.com/v1/accounts`) when set. This reads `process.env` directly rather than through `server-env.ts`'s schema — a deliberate, narrow exception to the "every env var goes through client-env.ts/server-env.ts" rule established in the post-Phase-6 hotfix: `FIREBASE_AUTH_EMULATOR_HOST` is not application configuration, it's a Firebase CLI convention set exclusively and transiently by `emulators:exec`/`emulators:start`, identical in kind to `adminAuth`'s own internal detection of the same variable, and it must never be set in a real deployment. Added a unit test (`identity-toolkit.test.ts`) proving the emulator-redirect branch, and confirmed the fix live: the manual REST call now round-trips through the emulator and the e2e spec passes end-to-end.

## 4. 7.3 — Security audit

**Firestore/Storage rules review.** Read `firestore.rules` (now 400+ lines) and `storage.rules` end to end. Confirmed by direct grep: every single write/create/update/delete rule in `firestore.rules` is unconditionally `allow write: if false` — literally every mutation in the entire app is Admin-SDK-only, with zero exceptions, and `isSuperAdmin()` is never combined with a write rule anywhere (read-only cross-tenant bypass, as documented). Tenant isolation (`isActiveMember`/`hasBranchAccess`) is present on every read rule; the file ends with an explicit default-deny catch-all. `storage.rules` denies everything except a user's own folder. No changes were needed — this is a strong existing posture, not a Phase 7 addition.

**Dependency audit.** `npm audit` reports 14 findings (12 moderate, 2 high) — all fixable only via major-version bumps of `next`, `firebase-admin`, or `firebase-tools`. One of `npm audit`'s own suggested "fixes" for the `next` finding is to downgrade Next.js from 16.2.10 to **9.3.3** — a nonsensical, actively dangerous "fix" that was not applied. Every finding traces to transitive dependencies of Google Cloud client libraries' HTTP retry plumbing (`teeny-request`/`retry-request`/`uuid`, reachable via `firebase-admin` and `@google-cloud/secret-manager`) or to `firebase-tools` itself (a devDependency — the local CLI/emulator tool, never shipped in the deployed Vercel bundle). None are directly exploitable by attacker-controlled input in this app's own code. No dependency was force-upgraded in this pass; doing so safely would need its own dedicated regression-testing effort, out of proportion with "smallest possible" changes for this round.

**Manual code-review checklist:** grepped for `dangerouslySetInnerHTML` (none), `eval`/`new Function` (none), hardcoded-looking secrets in source (none), and open-redirect risk in every `redirect()` call (the one dynamic case constructs a URL from a fixed literal path plus the current request's own origin, not attacker-controlled input). Spot-checked that Server Actions re-derive the actor's role from the stored membership document rather than trusting client input (`members-actions.ts`'s `outranks()` check) — consistent with the pattern already enforced everywhere else in Core.

**What this audit is not, stated honestly:** no live penetration test (real exploit attempts against a running deployment) was performed or is claimed — that is outside what a code-review pass can self-certify, and is recommended as a follow-up with a dedicated security engagement before a public launch, the same honesty standard applied earlier this session to WhatsApp's delivery guarantees.

## 5. 7.4 — Observability

**Structured logging** (`shared/observability/logger.ts`): a minimal JSON-per-line logger (`debug`/`info`/`warn`/`error`, each entry `{level, message, timestamp, context?}`) — no new dependency. `warn`/`error` go to `console.error` (stderr), `debug`/`info` to `console.log` (stdout), so a log drain that splits streams (Vercel does) routes severity correctly.

**Error reporting** (`shared/observability/error-reporter.ts`): `reportError(error, context)` always logs a structured entry (message, stack, route context) via the logger above — genuinely working today, since Vercel's function logs and any log-based alerting already capture stdout/stderr. A `registerErrorSink()` extension point exists for a real third-party service (Sentry, Datadog, etc.), deliberately left unregistered: wiring one in would mean either adding an SDK this session cannot exercise end-to-end (no account/DSN exists to verify delivery against) or hand-rolling that service's ingestion wire format with no way to confirm correctness — both risk shipping something that looks complete but silently fails in production. This mirrors the Vercel-environment-variable precedent from earlier this session: the code is ready, the account/credential is an operational step outside what this session can do.

Wired into two places: `src/instrumentation.ts`'s `onRequestError` hook (stable since Next.js 15 — catches Server Component, Route Handler, and Server Action errors uniformly, confirmed against the pinned Next.js docs in `node_modules/next/dist/docs` per `AGENTS.md`'s instruction to check this version's actual behavior rather than assume from training data) and `src/app/global-error.tsx` (the App Router's root client-side error boundary, using this Next version's `unstable_retry` prop — also confirmed against the pinned docs, since it differs from older `reset`-prop conventions).

**Uptime monitoring:** added `GET /api/health` (`src/app/api/health/route.ts`) — a fast, dependency-free liveness check (not a Firestore reachability check, deliberately: a dependency check adds latency and false-negative risk from a transient blip unrelated to whether the app itself is up). Configuring an actual external monitoring **service** (UptimeRobot, Better Uptime, Pingdom, etc.) against this endpoint is an operational step outside code, the same category as the Vercel environment variables — the endpoint is ready; nobody has pointed a monitor at it yet.

## 6. 7.5 — Monorepo extraction: deferred, precondition not met

The roadmap's own condition: extract to a monorepo **only if** a concrete App or Connector now needs independent deploys. Checked against the current state: every App (Restaurant, Retail, Loyalty, Kitchen Display, Barcode, AI Assistant) and every Connector (Shopify, Square, Odoo) ships as an internal module inside the single Next.js app, deployed together on every push, with no documented or requested need for any one of them to deploy on its own schedule or infrastructure. The precondition is not met, so this item is explicitly deferred, per the roadmap's own conditional language — no structural change was made.

## 7. Validation

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run test` — 650 passed, 161 skipped (811) — Playwright's `e2e/` specs are excluded from Vitest's own discovery (`vitest.config.mts`), since they require Playwright's runner, not Vitest's
- `npm run test:emulator` — **811/811 passed**
- `npm run test:e2e` — **1/1 passed** (real browser, real Next.js server, real Firestore/Auth emulators)
- `npm run build` — succeeds

## 8. Files touched (summary)

- `src/lib/firebase/pagination.ts` — `MAX_UNBOUNDED_LIST_SIZE`
- `src/core/inventory-engine/application/{items,stock}.ts` (+ tests) — defensive limits, `listMovementsPage`
- `src/core/order-engine/application/orders.ts` (+ tests) — defensive limit, `listOrdersPage`
- `src/core/inventory-engine/index.ts`, `src/core/order-engine/index.ts`, `src/core/index.ts` — barrel exports
- `firestore.indexes.json` — two new composites
- `src/core/companies/branches.ts` — `cache()` wrap
- `src/core/companies/queries.test.ts` — new, closes the one real coverage gap
- `src/core/auth/identity-toolkit.ts` (+ test) — emulator-awareness fix
- `src/shared/observability/{logger,error-reporter}.ts` (+ tests) — new
- `src/instrumentation.ts`, `src/app/global-error.tsx` — new
- `src/app/api/health/route.ts` (+ test) — new
- `package.json` — `@vitest/coverage-v8`, `@playwright/test`; `test:coverage`, `test:e2e` scripts
- `playwright.config.ts`, `e2e/onboarding.spec.ts` — new
- `vitest.config.mts` — exclude `e2e/**`
- `docs/DATABASE.md` — index section updated
