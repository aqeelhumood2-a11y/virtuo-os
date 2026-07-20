# Phase 1B — Authentication & Sessions: Implementation Plan

Status: **BLOCKED — conditionally approved, but implementation cannot start.** Verified against the real `virtuo-os` project via the Admin SDK (`adminAuth.listUsers()`): Firebase Authentication returns `auth/configuration-not-found`, meaning it has not been enabled in the Firebase Console yet. Per explicit instruction, implementation stops here — no workaround will be attempted. Once you've clicked "Get started" under Authentication in the Firebase Console and enabled the Email/Password provider, tell me and I'll re-verify and proceed.

## Amendments required at conditional approval (incorporated into this plan; code not yet written)

1. **Sign-up is approved, scope-limited exactly as specified**: creates only the Firebase Auth account (UID, email, verification status per Firebase config) and a valid session. No Firestore user document, company, role, permissions, membership, or onboarding data — all deferred to 1C. `signUpAction` will do nothing beyond `identity-toolkit.signUp()` + `createSessionCookie()`.
2. **Auth architecture approved as proposed** (session cookies only, httpOnly/Secure/SameSite=Lax, server-side verification only, no client-side auth-state trust, no client-side authorization logic anywhere).
3. **Security additions required, not yet in the original plan:**
   - CSRF protection on every auth Server Action.
   - Basic rate limiting for sign-in, sign-up, and password reset — leaning on Firebase's own native throttling (`TOO_MANY_ATTEMPTS_TRY_LATER`) where available, but the module boundary must be shaped so an application-level limiter can be dropped in later without a redesign.
   - Never leak whether an email exists (already planned) and never leak raw Firebase/internal error detail — every error surfaced to the user must go through the safe-message mapping, with no fallback path that echoes a provider error string.
4. **Session security additions:**
   - Session rotation after authentication (mint a fresh session cookie on sign-in/sign-up rather than reusing anything from a prior state).
   - Revoke *all* sessions on sign-out (`revokeRefreshTokens`, already planned — now explicit as a hard requirement, not just "defense in depth").
   - Explicit expired/invalid/revoked/tampered session handling with recovery (clear the dead cookie and redirect to `/login`, never a raw error page).
5. **Firestore: reconfirmed zero writes, zero collections, zero rule changes, zero profile documents.** Matches what was already planned in §3/§6 — restated here as a hard constraint, not just a default.
6. **Testing: additional required cases** beyond the original proposal — invalid session cookie, expired session cookie, revoked session, missing cookie, tampered cookie, CSRF failure, rate-limit behavior (mocked). Added to §7 below.
7. **Firebase Console gate: enforced.** See the BLOCKED status above — this is that exact check, and it failed.
8. **Dependencies: reconfirmed zero new libraries** — Firebase Authentication (via REST), Firebase Admin SDK, Next.js, and existing project dependencies only. No CSRF library, no rate-limiting library: both will be implemented with what's already available (Web Crypto for CSRF tokens, an in-memory/interface-based limiter for rate limiting — detailed in the revised plan once unblocked).

The remainder of this document (§1–§9 below) is the original proposal; it will be revised in place once the amendments above are threaded through §1 (flow), §2 (file list), §7 (testing), and §9 (risks) — that revision happens after the Console block clears, together with your go-ahead, not before.

Standing rules carried forward from Phase 1A's approval (apply to this phase and every phase after): architecture boundary tests remain part of CI; the client-env/server-env split is not altered; every new dependency needs a documented justification; Core stays completely business-agnostic.

## 0. A scope call that needs your explicit sign-off before anything else

The roadmap's Phase 1B scope list is: email/password authentication, session layer, protected routes, sign in, sign out, password reset, error handling, tests. It does not explicitly say "sign-up."

I'm treating **account creation (sign-up) as in-scope for 1B**, on this reasoning: creating a Firebase Auth credential (email + password) is purely an Authentication-system record — Firebase Auth has its own internal user store, entirely separate from Firestore. It does not create a Firestore document, a Company, a Membership, or a Role. Phase 1C's "company onboarding flow" is a distinct, later step: turning an already-authenticated identity into an app-level `users/{uid}` profile + a Company + an Owner membership. Phase 1B stops at "an authenticated Firebase Auth identity exists and can start a session" — nothing about *who they are in the business* is decided here.

**If you'd rather 1B only cover sign-in/out/reset for pre-existing accounts (created some other way, e.g. directly in the Firebase Console) and defer sign-up itself to 1C's onboarding step, tell me and I'll cut it from this plan.** Everything below assumes sign-up stays in 1B unless you say otherwise.

## 1. Detailed implementation plan (architecture decisions)

### Why Server Actions calling the Identity Toolkit REST API directly, not the client Firebase SDK

Firebase's Admin SDK can create/manage users and mint/verify session cookies, but it **cannot check a password** — password verification only exists in Firebase Auth's REST API (Identity Toolkit) or the client SDK, both of which ultimately call the same REST endpoints. Two architectures are possible:

- **(A) Client SDK signs in in the browser, then POSTs the resulting ID token to a Route Handler** that mints the session cookie. This is the more commonly seen pattern in Firebase tutorials.
- **(B) A Server Action calls the Identity Toolkit REST API directly** (`identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`, `:signUp`, `:sendOobCode`) using the existing `NEXT_PUBLIC_FIREBASE_API_KEY` (not a secret — it's already validated in `clientEnv` and safe to use from server code too), gets the ID token back, and mints the session cookie in the same action — no second round trip, no client-side Firebase SDK involvement in the sign-in path at all.

**Choosing (B).** It matches this Next.js version's own documented pattern (`<form action={serverAction}>` + `useActionState`, see `node_modules/next/dist/docs/01-app/02-guides/authentication.md`), it's one network hop instead of two, and it means the server — not client JS — is the only thing that ever decides "is this session valid," with zero dependency on client-side Firebase Auth state (no `onAuthStateChanged` listener, no risk of client/server auth-state drift). This also means **zero new npm dependencies**: the REST calls use the platform's global `fetch`; session cookie creation/verification uses `firebase-admin/auth`, already installed.

### The complete authentication flow

**Sign-up:**
1. User submits the sign-up form (Client Component, `useActionState`) → `signUpAction(prevState, formData)` Server Action.
2. Server Action validates `email`/`password` with Zod (email format; password ≥ 8 chars — stricter than Firebase's own 6-char minimum).
3. Calls `identitytoolkit.googleapis.com/v1/accounts:signUp?key=<NEXT_PUBLIC_FIREBASE_API_KEY>` with the credentials.
4. On success, Firebase returns an `idToken` for the brand-new account. The action immediately calls the same session-creation step as sign-in (step 3 below) so a fresh sign-up lands the user in an authenticated session without a separate manual sign-in.
5. On failure (`EMAIL_EXISTS`, `WEAK_PASSWORD`, etc.), the error is mapped to a safe, specific message (see error handling below) and returned as form state — no redirect.

**Sign-in:**
1. User submits the sign-in form → `signInAction(prevState, formData)`.
2. Zod validates the shape (non-empty email/password) — deliberately *not* re-validating password strength here (a previously-valid password shouldn't start failing client-side rules).
3. Calls `accounts:signInWithPassword` with the credentials.
4. On success: `createSessionCookie(idToken)` — calls `adminAuth.createSessionCookie(idToken, { expiresIn })`, then sets an `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/'` cookie via `next/headers`'s `cookies()`. Redirects to `/account` (see §0 in the plan file list — a bare technical placeholder, not a dashboard).
5. On failure (`EMAIL_NOT_FOUND`, `INVALID_PASSWORD`, `INVALID_LOGIN_CREDENTIALS`): mapped to one single generic message ("Invalid email or password") regardless of which of the two occurred — this is deliberate: distinguishing "wrong password" from "no such account" lets an attacker enumerate registered emails, so both collapse to the same message.

**Session verification (every subsequent request):**
1. A Data Access Layer function `getSession()` reads the session cookie and calls `adminAuth.verifySessionCookie(cookie, /* checkRevoked */ true)`.
2. Returns `{ uid: string } | null`. Cached per-request with React's `cache()` so multiple calls within one render/action don't re-verify.
3. `requireSession()` wraps this and redirects to `/login` if there's no valid session — used at the top of any protected Server Component/Server Action.
4. `proxy.ts` (this version's renamed `middleware.ts` — see below) does a **cheap, optimistic** check: does the session cookie merely *exist*? If not, redirect `/account` → `/login` before the page even renders. This is a UX fast-path only, never the security boundary — it deliberately does not call `verifySessionCookie` (that's an async Admin SDK call, and Proxy runs on every request including prefetches; the framework's own guidance is explicit that Proxy "should not be used as a full session management or authorization solution"). The real, authoritative check is `requireSession()` in the DAL, invoked server-side wherever it matters.

**Sign-out:**
1. `signOutAction()` reads the session cookie, verifies it to get the `uid`, calls `adminAuth.revokeRefreshTokens(uid)` (defense in depth — invalidates the underlying Firebase refresh token immediately, not just this one cookie), deletes the cookie, redirects to `/login`.

**Password reset:**
1. User submits their email on `/reset-password` → `requestPasswordResetAction(prevState, formData)`.
2. Calls `accounts:sendOobCode` with `requestType: 'PASSWORD_RESET'`. Firebase emails a reset link using its own default hosted action page (no custom email infrastructure in this phase — flagged as an assumption below).
3. **Always returns the same "if that email exists, a reset link has been sent" message, whether or not the account exists** — same user-enumeration reasoning as sign-in.

### Important architectural correction for this Next.js version

`middleware.ts` **does not exist in Next.js 16** — it was renamed to **`proxy.ts`** (`export function proxy(request)`, same file-convention rules, same `config.matcher`). This is confirmed directly from `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, not assumed from training data (per `AGENTS.md`'s instruction to check this version's actual docs before writing code). Proxy in this version also runs on the **Node.js runtime by default** (not Edge-only, unlike historical Middleware) — noted for completeness, but doesn't change the decision to keep Proxy's check optimistic-only.

## 2. Complete file list

**New — Core:**
- `src/core/auth/identity-toolkit.ts` — thin REST wrapper: `signUp()`, `signInWithPassword()`, `sendPasswordResetEmail()`, plus the error-code → safe-message mapping.
- `src/core/auth/identity-toolkit.test.ts`
- `src/core/auth/session.ts` — `createSessionCookie()`, `getSession()` (cached), `requireSession()`, `clearSession()`.
- `src/core/auth/session.test.ts`
- `src/core/auth/actions.ts` — Server Actions: `signUpAction`, `signInAction`, `signOutAction`, `requestPasswordResetAction`.
- `src/core/auth/actions.test.ts`
- `src/core/auth/types.ts` — `AuthFormState` shape shared by the four actions.
- `src/core/auth/constants.ts` — cookie name, session max-age, all in one place (no magic strings duplicated across files).

**New — routes:**
- `src/app/(auth)/layout.tsx` — minimal centered-card shell, no dashboard chrome, reuses `shared/ui`.
- `src/app/(auth)/login/page.tsx` + `src/app/(auth)/login/LoginForm.tsx` (Client Component, `useActionState`).
- `src/app/(auth)/register/page.tsx` + `.../RegisterForm.tsx` (only if §0's sign-up scope is confirmed).
- `src/app/(auth)/reset-password/page.tsx` + `.../ResetPasswordForm.tsx`.
- `src/app/account/page.tsx` — protected technical placeholder (`requireSession()` at the top; shows the signed-in UID/email and a sign-out button; explicitly **not** a dashboard, no company/business data).
- `src/app/account/SignOutButton.tsx` — Client Component invoking `signOutAction`.

**New — Proxy:**
- `src/proxy.ts` — optimistic cookie-presence redirect, matcher covering `/account` (protected) and the `(auth)` routes (redirect away if already signed in).
- `src/proxy.test.ts`.

**Modified:**
- `src/core/index.ts` — now re-exports `auth`'s public surface (`getSession`, `requireSession`, the four actions, `AuthFormState`) instead of being an empty barrel.
- `src/core/README.md` — updated to reflect Auth as implemented; Users/Companies/Branches/Roles/Inventory/Orders/Audit/Notifications still explicitly listed as not yet built.
- `docs/ROADMAP.md` — mark 1B in progress once implementation starts (not before approval).

**Not touched:** `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`, `.env.example`, `.env.local`, any `src/apps`/`src/connectors`/`src/settings` file, anything in `src/shared` except reusing existing `Button`/`Input`/`Card`/`FormField`.

## 3. Firestore collections and data model for authentication only

**None.** Firebase Authentication maintains its own account store (email, password hash, UID, disabled/verified flags) entirely separately from Firestore — there is no Firestore collection Phase 1B needs to create, read, or write to authenticate a user, start a session, or reset a password. A Firestore `users/{uid}` **profile** document (display name, company memberships, etc.) is explicitly a Phase 1C concern (Multi-Tenant Organization Model) — this phase produces only a verified Firebase Auth UID, nothing more, and stores nothing about that UID anywhere except inside the session cookie itself.

## 4. Server-side session mechanics

- **Cookie contents:** the value Firebase's `createSessionCookie` returns — an opaque, signed JWT-like token containing the UID and expiry, verifiable only with the Admin SDK's private key. The application never parses or trusts its contents without calling `verifySessionCookie`.
- **Cookie attributes:** `httpOnly: true` (inaccessible to JS — mitigates XSS token theft), `secure: true` (HTTPS-only; browsers treat `localhost` as a secure context so this still works in local dev), `sameSite: 'lax'` (blocks cross-site POST and cross-site fetch, which is Phase 1B's CSRF mitigation — no separate CSRF token needed given all state-changing operations are same-site Server Action POSTs), `path: '/'`.
- **Lifetime:** Firebase's `createSessionCookie` allows 5 minutes–14 days; using the 14-day maximum as the default, defined once in `constants.ts`.
- **Verification:** `getSession()` calls `verifySessionCookie(cookie, true)` — the `true` enables revocation checking, so a session cookie stops working immediately after `signOutAction`'s `revokeRefreshTokens` call, not just after natural expiry.
- **Caching:** `getSession()` is wrapped in React's `cache()` so it verifies at most once per request/render pass, not once per component that happens to call it.
- **No dependency on client-side Firebase Auth state** — nothing in `src/lib/firebase/client.ts`'s `auth` export is used this phase; the browser never independently decides "am I logged in," only the server's verified cookie does.

## 5. Tenant isolation in this phase

Phase 1B has no Company/Branch concept yet, so "tenant isolation" here means the narrower but foundational guarantee every later phase depends on: **a session is bound to exactly one verified Firebase Auth UID, and that UID always comes from server-side cryptographic verification of the session cookie — never from anything the client sends** (no UID in a request body, header, query param, or hidden form field is ever trusted). `requireSession()`/`getSession()` are the only source of truth for "who is making this request," everywhere in the codebase, starting now. Phase 1C builds Company/Branch-scoped tenant isolation directly on top of this UID — by design, nothing changes about how the UID itself is obtained when that happens.

## 6. Firestore security rules for this phase

**None required.** No Firestore collection is read or written by authentication. The existing `firestore.rules` (written during initial infra setup, before this phased plan existed) still contains a `/users/{userId}` block that doesn't correspond to any collection this codebase actually populates yet — it's inert either way, and cleaning it up properly belongs to Phase 1C, where the real `users` collection and its rules get designed together. Phase 1B does not deploy or modify `firestore.rules`.

## 7. Testing strategy

- **`identity-toolkit.test.ts`** — mocks global `fetch` (`vi.stubGlobal`), asserting: correct request shape sent to each endpoint; every documented Identity Toolkit error code maps to the intended safe message; unmapped/unexpected error codes fall back to a generic "something went wrong" rather than leaking a raw provider error string.
- **`session.test.ts`** — mocks `@/lib/firebase/admin`'s `adminAuth` export, asserting: `createSessionCookie` sets the cookie with exactly the intended attributes; `getSession` returns `null` (and does not throw) on a missing cookie, an expired cookie, and a revoked cookie; `getSession` returns `{ uid }` only on successful verification; `requireSession` redirects when `getSession` returns `null`.
- **`actions.test.ts`** — mocks `identity-toolkit.ts` and `session.ts`, asserting: Zod validation rejects malformed input before any network call is attempted; sign-in failure paths never reveal which of "no account"/"wrong password" occurred; sign-up success immediately establishes a session; sign-out calls `revokeRefreshTokens` before clearing the cookie; password reset returns the same response text regardless of whether the mocked lookup "succeeds" or "fails."
- **`proxy.test.ts`** — constructs a `NextRequest` directly (no server needed) and asserts: a request to `/account` with no session cookie redirects to `/login`; the same request with a (merely present, not cryptographically checked) cookie passes through; a request to `/login` with a cookie present redirects to `/account`.
- **UI:** `LoginForm`/`RegisterForm`/`ResetPasswordForm` get the same colocated-test treatment as Phase 1A's `shared/ui` components — render, submit, show returned form-state errors — with the Server Action itself mocked (these are UI-behavior tests, not integration tests of the real network path).
- **Not in scope for this phase:** a real Firebase Auth Emulator-backed integration test (spinning up `firebase emulators:start --only auth` in CI and exercising the real REST endpoints against it) would catch anything the mocks get wrong about Firebase's actual behavior, at the cost of new CI complexity (Java runtime, port/process management). **Flagging this as an option, not deciding it — tell me if you want it included in this phase or deferred.**

## 8. Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass.
2. A new account can be created, is immediately signed in, can sign out, and can sign back in — verified by the mocked-boundary test suite (and manually against the real project once Firebase Auth is enabled in the console, see the risk below).
3. Visiting `/account` while signed out redirects to `/login`; visiting `/login` while signed in redirects to `/account`.
4. Sign-in never distinguishes "no such account" from "wrong password" in its error message; password reset never distinguishes "account exists" from "account doesn't."
5. No Firestore collection, rule, or index is created, read, written, or deployed.
6. No client-side Firebase Auth SDK usage is introduced (`src/lib/firebase/client.ts` remains unused this phase).
7. Zero new npm dependencies.
8. `src/core/auth` contains only authentication/session logic — no `User`/`Company`/`Branch`/`Role` type or collection appears anywhere in the diff.
9. The architecture boundary test suite from Phase 1A still passes unmodified, proving `src/core/auth` doesn't violate any existing zone.
10. `/account` remains a bare technical placeholder — no business data, no fake statistics, no dashboard chrome.

## 9. Risks and assumptions

- **Blocking dependency, needs your confirmation:** earlier in this project, Firebase Authentication in the Console still needed you to click "Get started" and enable the Email/Password provider (this was flagged as a pending manual step before Phase 1A began, alongside the Storage/Blaze-plan step). If that still hasn't been done, the code in this phase will be correct but non-functional against the real `virtuo-os` project until it is — unit tests (all boundaries mocked) aren't affected, but real manual verification will be. Please confirm whether that console step is done.
- **Assumption:** password reset uses Firebase's default hosted action page/email template — no custom email service or branded reset page in this phase. Flagging in case you want a custom action URL/branded email now rather than later.
- **Assumption:** sign-up is in scope for 1B (see §0) — the single biggest scope call in this plan, explicitly called out for your override.
- **Assumption:** no rate-limiting/lockout logic is implemented beyond what Identity Toolkit already enforces natively (`TOO_MANY_ATTEMPTS_TRY_LATER`), which is simply surfaced as an error message, not reimplemented.
- **No risk to Firebase resources:** this phase makes no Console/CLI calls and deploys no Firestore rules; it only calls the already-existing Identity Toolkit REST API and Admin SDK Auth methods over the network at request time.
