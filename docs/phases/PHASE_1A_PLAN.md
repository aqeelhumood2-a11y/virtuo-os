# Phase 1A — Foundation: Implementation Plan

Status: **awaiting approval — no code written yet.**

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
├── package.json                          # MODIFIED (scripts + deps)
├── eslint.config.mjs                     # MODIFIED (boundary rules)
└── src/
    ├── app/
    │   ├── globals.css                   # MODIFIED (Tailwind v4 + tokens)
    │   ├── layout.tsx                    # MODIFIED (metadata only)
    │   ├── page.tsx                      # MODIFIED (remove starter content)
    │   └── page.module.css               # DELETE
    ├── core/README.md                    # NEW (empty boundary placeholder)
    ├── apps/README.md                    # NEW (empty boundary placeholder)
    ├── connectors/README.md              # NEW (empty boundary placeholder)
    ├── settings/README.md                # NEW (empty boundary placeholder)
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
    │       ├── env.ts                     # NEW
    │       └── env.test.ts                # NEW
    └── lib/firebase/
        └── config.ts                      # MODIFIED — delegates to shared/config/env.ts
```

Nothing is created under `core/<module>/…`, `apps/<name>/…`, or `connectors/<name>/…` yet — those folders exist only as empty boundary markers (a `README.md` stating "reserved for Phase 1B/1C/1D" / "reserved for Phase 3" / "reserved for Phase 2/5") so the import-boundary lint rules have real paths to reference from commit one, without pre-empting the planning of those sub-phases.

## 2. Files to create / modify / delete

Create: `.github/workflows/ci.yml`, `postcss.config.mjs`, `vitest.config.mts`, `vitest.setup.ts`, `src/core/README.md`, `src/apps/README.md`, `src/connectors/README.md`, `src/settings/README.md`, all `src/shared/**` files listed above.

Modify: `package.json` (scripts: `typecheck`, `test`, `test:watch`; deps below), `eslint.config.mjs` (boundary rules), `src/app/globals.css`, `src/app/layout.tsx` (metadata title/description only — no structural change), `src/app/page.tsx` (drop starter content), `src/lib/firebase/config.ts` (delegate to `shared/config/env.ts`).

Delete: `src/app/page.module.css`.

No `.env.example` / `.env.local` changes — Foundation introduces no new required variables; it formalizes validation of what's already there.

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

## 6. Environment validation strategy

- `src/shared/config/env.ts` defines two Zod schemas:
  - `clientEnvSchema` — only `NEXT_PUBLIC_*` keys (the six Firebase web-config values already in `.env.local`), safe to import from client components.
  - `serverEnvSchema` — `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`; this half of the file starts with `import "server-only"` so a client-component import fails at build time, not at runtime in production.
- Each schema is parsed once at module load (`schema.parse(process.env)`), so a missing/misconfigured variable throws immediately at startup/build — not silently as `undefined` deep in unrelated code, and not only on whichever request happens to touch it first.
- Zod's `.flatten()`/`issues` are used to produce one error message listing every missing/invalid variable together, not a trial-and-error one-at-a-time discovery.
- `src/lib/firebase/config.ts`'s existing hand-rolled `getFirebaseConfig()` (added during initial Firebase setup) is replaced with a thin adapter over the new `clientEnv` export — collapsing two separate ad hoc validation paths into one canonical source.
- `zod` is added as an explicit **direct** dependency (it is already present transitively via another package's dependency tree, but importing it directly without declaring it is fragile — this phase formalizes it as a real dependency, reused for Firestore document schema validation starting Phase 1C, rather than adding a redundant validation library later).

## 7. Import-boundary rules

Both mechanisms below already ship inside `eslint-config-next`'s existing `eslint-plugin-import` dependency — **no new ESLint plugin dependency required**.

**a) `import/no-restricted-paths`** (folder-to-folder zones) in `eslint.config.mjs`:
- Core cannot depend on Apps or Connectors — target `src/core/**`, forbidden `from: ['src/apps/**', 'src/connectors/**']`.
- Connectors must remain isolated — target `src/connectors/**`, forbidden `from: ['src/core/**', 'src/apps/**']`.
- Apps cannot reach Connectors directly — target `src/apps/**`, forbidden `from: ['src/connectors/**']`.

**b) Built-in ESLint `no-restricted-imports` (`patterns`)** — once Core modules gain internal `domain/application/infrastructure` layers (Phase 1E/1F), this keeps Apps/Shared from reaching past a module's public barrel: only `@/core/<module>` is importable from outside `src/core/**`, not `@/core/<module>/domain/*` etc. This directly implements "Apps may depend only on approved Core and Shared interfaces."

Both rules are configured now, even though no Core/Apps/Connectors code exists yet to violate them — that's intentional ("real from the first commit," not retrofitted). During implementation, a temporary throwaway fixture file will be added, confirmed to fail lint under each rule, then deleted before committing — so the rules are proven correct against nothing being merged that only *looks* right.

## 8. CI checks and commands

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

`.github/workflows/ci.yml`: triggers on `push` and `pull_request` (any branch); one job — checkout, `actions/setup-node@v4` (Node 22, npm cache), `npm ci`, then `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, each a separate step so a failure points at the exact stage. This is the mechanical enforcement behind "never break main."

## 9. Testing strategy for Phase 1A

Vitest + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`, per Next.js's own documented setup for this version. `vitest.config.mts` uses `vite-tsconfig-paths` (so `@/*` resolves in tests) and `@vitejs/plugin-react`, `environment: 'jsdom'`. `vitest.setup.ts` registers `@testing-library/jest-dom/vitest` matchers.

Covered in 1A (nothing else exists yet, so this is deliberately small):
- Every `shared/ui` component: renders, forwards `className`/props, and the one behavior that matters most for that component (label/error association for `Input`/`FormField`; focus trap + `Escape`/backdrop dismissal for `Modal`).
- `shared/config/env.ts`: throws with a clear, complete error on missing/invalid vars; parses successfully with valid ones — tests mock `process.env` directly (`vi.stubEnv` + `vi.resetModules()`), never touching real `.env.local`.

Not covered in 1A: Firestore/Auth security-rules tests (nothing is behind those rules yet — Foundation touches no Firebase resources) and no end-to-end/browser tests (nothing interactive enough to warrant one until 1B ships real auth flows).

## 10. Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass locally and in CI with zero errors/new warnings.
2. Homepage renders using Tailwind utility classes and at least one `shared/ui` component; no Next.js/create-next-app starter content (logo, "Deploy Now", template links) remains.
3. `shared/ui` exports `Button`, `Input`, `Card`, `Modal`, `FormField` from a single barrel (`src/shared/ui/index.ts`), each with a passing test.
4. `shared/config/env.ts` is the single validated source of environment variables; `lib/firebase/config.ts` consumes it instead of its own ad hoc check.
5. The three `no-restricted-paths` zones and the `no-restricted-imports` pattern rule are present in `eslint.config.mjs` and proven (during implementation, via a temporary fixture) to actually fail lint when violated.
6. `.github/workflows/ci.yml` exists and is green on the pushed commit.
7. No Firebase Console/Admin SDK calls were made; no Firestore rules, collections, or project config changed.
8. No authentication, companies, branches, memberships, roles, inventory, orders, notifications, audit logs, or vertical-specific code exists anywhere in the diff — `src/core`, `src/apps`, `src/connectors`, `src/settings` contain only their placeholder `README.md`.
9. Every new/changed file is committed with a clear message and pushed to `claude/firebase-setup-virtuo-os-l071hm`.

## 11. Risks and assumptions

- **Assumption:** Tailwind v4 (CSS-first `@theme`) over v3/`tailwind.config.js`, matching this Next.js version's documented default. Flagging explicitly in case you specifically need v3's broader legacy-browser support instead.
- **Assumption:** `zod` becomes a declared direct dependency now rather than deferring the schema-validation-library choice to Phase 1C — it's already present transitively, and env validation is a natural, minimal first use.
- **Risk:** the import-boundary rules are unproven against real Core/Apps/Connectors code in 1A since none exists yet; they get their first real exercise in 1B and may need small adjustment then. Called out rather than hidden.
- **Risk:** `core/`, `apps/`, `connectors/`, `settings/` contain only placeholder READMEs after 1A — the "project structure" deliverable is the *boundary*, not populated modules; those appear starting 1B/1C.
- **No risk to Firebase:** this phase makes no calls to Firebase Console, CLI, or Admin SDK; the already-provisioned project, Firestore rules, and the still-pending Auth/Storage console steps from earlier are untouched.
