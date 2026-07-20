# Phase 1A — Foundation: Implementation Plan

Status: **approved with mandatory amendments below — implementing now.**

## Amendments incorporated (post-review)

1. **Environment validation is split into two modules**, not one: `src/shared/config/client-env.ts` (validates only `NEXT_PUBLIC_*`, safe for client components) and `src/shared/config/server-env.ts` (`import "server-only"` as its first line; Firebase Admin credentials only). Neither module imports the other. §6 rewritten below.
2. **CI environment strategy defined**: GitHub Actions gets safe, non-secret, clearly-fake placeholder `NEXT_PUBLIC_*` values (Firebase Web SDK config is not a secret) set directly in the workflow YAML with an explanatory comment; Firebase Admin credentials are never added to CI in this phase. §8 rewritten below.
3. **Import-boundary verification is permanent**, not a deleted fixture: a real test suite (`tests/architecture/import-boundaries.test.ts`) runs ESLint's Node API against fixture files on every `npm run test` / CI run, asserting each prohibited import actually fails and at least one allowed import doesn't. §7 and §9 rewritten below.
4. **Rule attribution corrected/clarified**: `no-restricted-imports` is a **core ESLint rule** (not part of `eslint-plugin-import`); `import/no-restricted-paths` **is** the `eslint-plugin-import` rule. Both are used, for different jobs, per §7.
5. **Homepage stays a technical placeholder** — no dashboard, auth screens, onboarding, business UI, or fake data of any kind.
6. **Firebase scope reaffirmed**: no resource changes, no rules deployment, no auth logic, no client-side Admin SDK use, no Storage functionality.

Scope reminder: Tailwind, base UI kit, project structure, shared types, environment validation, import-boundary lint rules, CI checks. No business features, no Firebase resource changes beyond what's strictly required (none are required for this phase).

## 1. Exact folder structure (new + changed, relative to repo root)

```
virtuo-os/
├── .github/
│   └── workflows/
│       └── ci.yml                       # NEW
├── docs/phases/PHASE_1A_PLAN.md          # NEW (this file)
├── postcss.config.mjs                    # NEW
├── vitest.config.mts                     # NEW
├── vitest.setup.ts                       # NEW
├── test/mocks/server-only.ts             # NEW — see §6/§9, aliased in vitest.config.mts
├── tests/architecture/import-boundaries.test.ts   # NEW — permanent boundary verification, see §7
├── package.json                          # MODIFIED (scripts + deps)
├── eslint.config.mjs                     # MODIFIED (boundary rules)
└── src/
    ├── app/
    │   ├── globals.css                   # MODIFIED (Tailwind v4 + tokens)
    │   ├── layout.tsx                    # MODIFIED (metadata only)
    │   ├── page.tsx                      # MODIFIED (remove starter content)
    │   └── page.module.css               # DELETE
    ├── core/
    │   ├── README.md                     # NEW (boundary placeholder, reserved for 1B+)
    │   └── index.ts                      # NEW — empty barrel, gives the boundary rules/tests a real resolvable target
    ├── apps/
    │   ├── README.md                     # NEW (boundary placeholder, reserved for Phase 3+)
    │   └── index.ts                      # NEW — same purpose as core/index.ts
    ├── connectors/
    │   ├── README.md                     # NEW (boundary placeholder, reserved for Phase 2/5+)
    │   └── index.ts                      # NEW — same purpose
    ├── settings/
    │   ├── README.md                     # NEW (boundary placeholder, reserved for Phase 2+)
    │   └── index.ts                      # NEW — same purpose
    ├── shared/
    │   ├── ui/
    │   │   ├── Button.tsx                # NEW
    │   │   ├── Button.test.tsx           # NEW
    │   │   ├── Card.tsx                  # NEW
    │   │   ├── Card.test.tsx             # NEW
    │   │   ├── Input.tsx                 # NEW
    │   │   ├── Input.test.tsx            # NEW
    │   │   ├── Modal.tsx                 # NEW
    │   │   ├── Modal.test.tsx            # NEW
    │   │   ├── FormField.tsx             # NEW
    │   │   ├── FormField.test.tsx        # NEW
    │   │   └── index.ts                  # NEW — public barrel
    │   ├── types/
    │   │   ├── result.ts                 # NEW
    │   │   ├── firestore.ts              # NEW
    │   │   └── index.ts                  # NEW — public barrel
    │   ├── utils/
    │   │   └── cn.ts                      # NEW
    │   └── config/
    │       ├── client-env.ts              # NEW — replaces the single env.ts from the original plan
    │       ├── client-env.test.ts         # NEW
    │       ├── server-env.ts              # NEW — `import "server-only"` first line
    │       └── server-env.test.ts         # NEW
    └── lib/firebase/
        ├── config.ts                      # MODIFIED — delegates to shared/config/client-env.ts
        └── admin.ts                       # MODIFIED — delegates to shared/config/server-env.ts (removes its own ad hoc process.env checks)
```

`src/core/index.ts`, `src/apps/index.ts`, `src/connectors/index.ts`, `src/settings/index.ts` are each just an empty barrel (`export {};` plus a one-line comment naming the phase that populates them) — not business logic, but a real, resolvable file the ESLint import-boundary rules and the permanent architecture test can actually import in a fixture. A `README.md`-only placeholder (the original plan) cannot be imported by TypeScript, so the boundary rules would have nothing real to test against; this is the minimal change needed to make the amendment's "permanent, provable" requirement possible.

## 2. Files to create / modify / delete

Create: `.github/workflows/ci.yml`, `postcss.config.mjs`, `vitest.config.mts`, `vitest.setup.ts`, `test/mocks/server-only.ts`, `tests/architecture/import-boundaries.test.ts`, `src/{core,apps,connectors,settings}/{README.md,index.ts}`, all `src/shared/**` files listed above.

Modify: `package.json` (scripts: `typecheck`, `test`, `test:watch`; deps below), `eslint.config.mjs` (boundary rules), `src/app/globals.css`, `src/app/layout.tsx` (metadata title/description only — no structural change), `src/app/page.tsx` (drop starter content), `src/lib/firebase/config.ts` (delegate to `shared/config/client-env.ts`), `src/lib/firebase/admin.ts` (delegate to `shared/config/server-env.ts`).

Delete: `src/app/page.module.css`.

No `.env.example` / `.env.local` changes — Foundation introduces no new required variables; it formalizes validation of what's already there. The real `.env.local` is never committed (already gitignored, verified) and never copied into CI.

## 3. UI kit components in this phase

`Button`, `Input`, `Card`, `Modal`, `FormField` (label + error-message wrapper around a form control). Deliberately excludes `Table` — no phase needs tabular data yet; it's added in 1C when company/branch/member lists first need one, so it's designed against a real consumer instead of guessed. Each component: typed props (no `any`), forwards `className` merged via `cn()`, forwards `ref` where it wraps a native element, and has one colocated test confirming it renders and behaves (e.g. `Modal` traps focus and closes on `Escape`/backdrop click; `Input`/`FormField` associate label and error via `aria-describedby`).

## 4. Tailwind configuration approach

Tailwind **v4**, CSS-first — confirmed as the current default by Next.js's own bundled docs for this version (`node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`), as opposed to the separate legacy v3/`tailwind.config.js` guide.

- Add `tailwindcss` and `@tailwindcss/postcss` as devDependencies.
- `postcss.config.mjs`:
  ```js
  export default { plugins: { '@tailwindcss/postcss': {} } };
  ```
- No `tailwind.config.js`. Theme customization lives in CSS via `@theme` in `globals.css`:
  ```css
  @import "tailwindcss";

  @theme {
    --font-sans: var(--font-geist-sans);
    --font-mono: var(--font-geist-mono);
    /* a minimal brand/neutral color scale and radius scale — expanded only
       when a later phase's UI actually needs a new token, not speculatively */
  }
  ```
- Keep the existing Geist font wiring in `layout.tsx` (already set up by `create-next-app`); point the theme's `--font-sans`/`--font-mono` at the existing `--font-geist-sans`/`--font-geist-mono` CSS variables instead of introducing a new font.
- Remove the old hand-rolled `:root { --background; --foreground }` block, the dark-mode media query, and the Arial `font-family` rule from `globals.css` — Tailwind's base layer plus the new tokens replace them.
- Delete `page.module.css`; Tailwind utility classes replace CSS Modules for the placeholder homepage.

## 5. Shared types in this phase

Only what Foundation itself needs plus the couple of primitives every later sub-phase would otherwise reinvent independently:
- `Result<T, E = AppError>` — discriminated-union success/failure wrapper, so 1B onward has one error-handling convention for server actions instead of five ad hoc ones.
- `AppError` — minimal typed error shape (`code: string`, `message: string`) used by `Result`.
- `WithId<T>` / `FirestoreTimestamp` — small structural helpers for "a Firestore document's data plus its id" and timestamp fields, reused by every Core module from 1C onward.

Deliberately **not** included: `Role`, `Permission`, `Company`, `Branch`, `User`, or any domain type — those are 1C's/1D's own planning decisions, not Foundation's to pre-empt.

## 6. Environment validation strategy (amended: two separate modules)

- **`src/shared/config/client-env.ts`** — validates only `NEXT_PUBLIC_*` keys (the six Firebase web-config values already in `.env.local`). No `server-only` import — this module is safe to import from client components, because it contains nothing that isn't already safe to ship to the browser. Firebase's `NEXT_PUBLIC_*` web config values are **not treated as secrets** here or anywhere: they are public identifiers, protected by Firestore/Storage Security Rules, not by concealment.
- **`src/shared/config/server-env.ts`** — validates `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. Its **first line** is `import "server-only"`, so if any client component or client-bundled module ever imports it, the Next.js build fails immediately and explicitly (this is the runtime/build-time half of the boundary enforcement described in §7).
- **The two modules never import each other or share a schema.** Each parses its own slice of `process.env` independently.
- Each schema is parsed once at module load (`schema.parse(process.env)` inside a small `parseXEnv(source)` function, called once per module and exported as a constant), so a missing/misconfigured variable throws immediately at startup/build — not silently as `undefined` deep in unrelated code, and not only on whichever request happens to touch it first.
- **Error messages never include variable values** — only the list of offending key names (built manually from `error.issues.map(i => i.path.join('.'))`), never `console.log`/`console.error` of the raw env object or any parsed value. This satisfies "do not log environment variable values" while still telling a developer exactly what's missing.
- `src/lib/firebase/config.ts`'s existing hand-rolled `getFirebaseConfig()` is replaced with a thin adapter over `clientEnv`. `src/lib/firebase/admin.ts`'s existing inline `process.env.FIREBASE_*` checks are replaced with `serverEnv` from the new module — this was not in the original plan's file list, but it directly serves the "single canonical source of validated env" goal from the original approval and removes a second, now-inconsistent, ad hoc validation path. No behavior changes: `admin.ts` still throws if credentials are missing, just via the shared schema instead of its own bespoke check.
- `zod` is added as an explicit **direct** dependency (already present transitively; importing it directly without declaring it is fragile). Reused for Firestore document schema validation starting Phase 1C.

### Testability of `server-env.ts` under Vitest

The `server-only` package's default export condition throws unconditionally outside of Next.js's own webpack build (Next special-cases this package per compilation target; Vitest does not). To let `server-env.test.ts` exercise the real module, `vitest.config.mts` aliases the bare specifier `server-only` to `test/mocks/server-only.ts` — a one-line empty stub — **only inside the Vitest test runner**. This does not affect `next build`/`next dev`/production in any way (those use Next's own webpack resolution, where the real `server-only` package's client-vs-server behavior is unchanged and still enforced). This is a standard, documented pattern for testing server-only-marked modules and is called out explicitly here rather than left implicit.

## 7. Import-boundary rules (amended: permanent verification, corrected rule attribution)

Rule sourcing, stated precisely per the required clarification:
- **`import/no-restricted-paths`** is a rule from the **`eslint-plugin-import`** plugin (already a dependency of `eslint-config-next`, and added as an explicit direct devDependency in this phase for reproducibility — see §8/§11). It matches import statements by the *resolved file path* of both the importing file and the imported target against glob "zones."
- **`no-restricted-imports`** is a **core ESLint rule** (ships with ESLint itself, no plugin needed). It matches import statements by the *literal specifier string* (e.g. `@/core/inventory-engine/domain/item`), which makes it the right tool for "only the module's barrel is importable," a job `no-restricted-paths` isn't suited to (it works on resolved paths, not on which segment of the path was written in the source).

**Zones configured in `eslint.config.mjs` (`import/no-restricted-paths`):**
1. Core cannot depend on Apps or Connectors — target `./src/core/**/*`, forbidden `from: ['./src/apps/**/*', './src/connectors/**/*']`.
2. Connectors must remain isolated — target `./src/connectors/**/*`, forbidden `from: ['./src/core/**/*', './src/apps/**/*']`.
3. Apps cannot reach Connectors directly — target `./src/apps/**/*`, forbidden `from: ['./src/connectors/**/*']`.
4. Client-facing UI cannot import the server-only env module — target `./src/shared/ui/**/*`, forbidden `from: ['./src/shared/config/server-env.ts']`. This is a static, fast-fail check; the authoritative enforcement for *any* client bundle anywhere (not just `shared/ui`) is `server-env.ts`'s own `import "server-only"` line, which fails the real `next build` if violated from anywhere in the client graph — the lint zone and the runtime marker are deliberately layered, not redundant.

**Deferred, not part of this phase's permanent test:** the core `no-restricted-imports` "barrel-only" pattern rule for Core's internal `domain/application/infrastructure` layers. Those folders don't exist until Phase 1E/1F create them — adding a pattern rule referencing nonexistent paths now would be config for its own sake, not a provable boundary. It's documented here so it isn't forgotten, and lands with 1E/1F.

**Permanent verification (`tests/architecture/import-boundaries.test.ts`):** rather than a fixture added and deleted before commit, a real Vitest test file uses ESLint's Node API (`new ESLint({ cwd, overrideConfigFile })` + `.lintText(code, { filePath })`) to lint small in-memory fixtures at fabricated-but-realistic paths (resolvable thanks to the `index.ts` barrels from §1), asserting:
- Each of the 5 required prohibited-import cases actually reports an `import/no-restricted-paths` error.
- Connectors-cannot-import-Core (part of "isolated," beyond the minimum 5) also reports an error — included since the zone already claims to enforce it.
- At least one allowed case (Apps importing Core's barrel, Core importing Shared) reports **zero** `import/no-restricted-paths` errors — a negative control, so the test can't pass merely because a rule fires on everything.

This file is committed permanently and runs on every `npm run test` and every CI run — it is the mechanism that makes the boundary rules provable on an ongoing basis, not a one-time manual check.

## 8. CI checks and commands (amended: explicit no-`.env.local` strategy)

`package.json` scripts:
```json
{
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "build": "next build"
}
```

`.github/workflows/ci.yml`: triggers on `push` and `pull_request` (any branch); one job — checkout, `actions/setup-node@v4` (Node 22, npm cache), `npm ci`, then `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, each a separate step so a failure points at the exact stage.

**CI environment strategy (GitHub Actions has no `.env.local`):**
- The job's `env:` block sets **safe, obviously-fake placeholder values** for the six `NEXT_PUBLIC_FIREBASE_*` keys directly in the workflow YAML (e.g. `NEXT_PUBLIC_FIREBASE_PROJECT_ID: "ci-placeholder"`), with a comment explaining why. This is safe specifically *because* these values are not secrets — Firebase Web SDK config is meant to ship in the client bundle; nothing here is real or points at the actual `virtuo-os` Firebase project.
- **Firebase Admin credentials are never added to the workflow in this phase.** Nothing in Phase 1A's lint/typecheck/test/build path imports `server-env.ts` from a page or route that would force `next build` to need it (Foundation adds no auth/business code), so no placeholder or real Admin credential is required in CI at all right now. This will be revisited honestly in whichever phase first adds a server action or route handler that actually calls `serverEnv` — not stubbed preemptively.
- **Runtime validation is not weakened to make CI pass.** The schemas are exactly as strict in CI as in production; CI just happens to supply harmless placeholder values that satisfy the schema's shape (non-empty strings) without being connected to any real project.
- **Production (Vercel) is unaffected by any of this.** Vercel is a completely separate environment with its own project-level env vars (the real ones, set by whoever configures the Vercel project) — the GitHub Actions placeholders never reach it. If Vercel is ever missing a genuinely required variable, the exact same `client-env.ts`/`server-env.ts` throw fires there too, because the validation code path is identical; this is proven by the "throws on missing/invalid input" tests in `client-env.test.ts`/`server-env.test.ts`, which exercise that exact throw with an empty input, independent of which environment calls it.
- The real `.env.local` is never committed and never uploaded to GitHub Actions as a secret in this phase — there is nothing in it CI needs yet.

## 9. Testing strategy for Phase 1A

Vitest + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`, per Next.js's own documented setup for this version. `vitest.config.mts` uses `vite-tsconfig-paths` (so `@/*` resolves in tests) and `@vitejs/plugin-react`, `environment: 'jsdom'`. `vitest.setup.ts` registers `@testing-library/jest-dom/vitest` matchers.

Covered in 1A (nothing else exists yet, so this is deliberately small):
- Every `shared/ui` component: renders, forwards `className`/props, and the one behavior that matters most for that component (label/error association for `Input`/`FormField`; focus trap + `Escape`/backdrop dismissal for `Modal`).
- `shared/config/client-env.ts` and `shared/config/server-env.ts` (separately): each throws a clear, complete, **value-free** error on missing/invalid input; each parses successfully with valid input. Tests never statically import these modules at file top-level (a static import would run the real, un-mocked `process.env` through the schema before the test body executes); instead each test case calls `vi.resetModules()` + `vi.stubEnv(...)` (or constructs a plain object and calls the exported parse function directly) then dynamically `await import(...)`s the module. Real `.env.local` is never read by these tests.
- `tests/architecture/import-boundaries.test.ts` (see §7) — the permanent boundary verification, run as part of the same `npm run test`.

Not covered in 1A: Firestore/Auth security-rules tests (nothing is behind those rules yet — Foundation touches no Firebase resources) and no end-to-end/browser tests (nothing interactive enough to warrant one until 1B ships real auth flows).

## 10. Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass locally and in CI with zero errors/new warnings.
2. Homepage renders using Tailwind utility classes and at least one `shared/ui` component; no Next.js/create-next-app starter content (logo, "Deploy Now", template links) remains; no dashboard, auth screen, onboarding flow, business UI, or fake data.
3. `shared/ui` exports `Button`, `Input`, `Card`, `Modal`, `FormField` from a single barrel (`src/shared/ui/index.ts`), each with a passing test.
4. `shared/config/client-env.ts` and `shared/config/server-env.ts` are separate modules; `server-env.ts` starts with `import "server-only"`; `lib/firebase/config.ts` and `lib/firebase/admin.ts` consume them instead of their own ad hoc checks; no error message anywhere logs an actual variable value.
5. The 4 `import/no-restricted-paths` zones are present in `eslint.config.mjs`, and `tests/architecture/import-boundaries.test.ts` proves — permanently, in CI, every run — that each of the 5 required prohibited-import cases fails lint and at least one allowed case doesn't.
6. `.github/workflows/ci.yml` exists, is green on the pushed commit, and documents (via comment) the placeholder-env strategy; no Firebase Admin credential appears in it.
7. No Firebase Console/CLI/Admin SDK calls were made; no Firestore rules, collections, Auth config, or Storage functionality added or changed.
8. No authentication, companies, branches, memberships, roles, inventory, orders, notifications, audit logs, or vertical-specific code exists anywhere in the diff — `src/core`, `src/apps`, `src/connectors`, `src/settings` contain only their placeholder `README.md` + empty `index.ts` barrel.
9. Every new/changed file is committed with a clear message and pushed to `claude/firebase-setup-virtuo-os-l071hm`.

## 11. Risks and assumptions

- **Assumption:** Tailwind v4 (CSS-first `@theme`) over v3/`tailwind.config.js`, matching this Next.js version's documented default. Flagging explicitly in case you specifically need v3's broader legacy-browser support instead.
- **Assumption:** `zod` and `eslint-plugin-import` become declared direct dependencies now (both already present transitively) rather than relying on transitive hoisting, which is fragile across installs.
- **Assumption:** the `server-only` → `test/mocks/server-only.ts` alias is scoped to `vitest.config.mts` only and never touches `next.config.ts` or production bundling — verified by inspecting the real package's conditional-export behavior (§6) before choosing this approach, not guessed.
- **Risk:** the core `no-restricted-imports` "barrel-only" pattern rule for Core's internal layers is explicitly deferred to Phase 1E/1F (§7), since those folders don't exist yet — flagged rather than configured against paths that can't yet be tested.
- **Risk:** `core/`, `apps/`, `connectors/`, `settings/` contain only placeholder READMEs + empty barrels after 1A — the "project structure" deliverable is the *boundary*, not populated modules; those appear starting 1B/1C.
- **No risk to Firebase:** this phase makes no calls to Firebase Console, CLI, or Admin SDK; the already-provisioned project, Firestore rules, and the still-pending Auth/Storage console steps from earlier are untouched.
