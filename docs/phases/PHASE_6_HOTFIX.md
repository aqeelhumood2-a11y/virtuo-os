# Post-Phase-6 Hotfix — Vercel Production build failure

Status: **implemented**. Not a new phase; a targeted fix discovered during Phase 6's post-merge Production deploy.

## 1. Symptom

Vercel's Production deployment (triggered by the Phase 6 merge to `main`) failed with:
```
Error: Invalid or missing client environment variables
...
Failed to collect page data for /api/webhook...
```

## 2. Root cause

This is a **pre-existing architectural coupling, not a Phase 6 regression**. `src/lib/firebase/admin.ts` — imported by nearly every Core/Platform function, including fully server-side paths that never touch the browser (e.g. `src/app/api/webhooks/[connectorId]/route.ts`) — read its Storage bucket name from `clientEnv` (`src/shared/config/client-env.ts`), not `serverEnv`:

```ts
// before
storageBucket: clientEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
```

`clientEnv` is a module-level singleton (`export const clientEnv = parseClientEnv(process.env)`) that validates **all six** `NEXT_PUBLIC_FIREBASE_*` variables at import time and throws if any is missing. Because `admin.ts` imported it, *any* code path that only ever needed `adminDb`/`adminAuth`/`adminStorage` — including the webhook route, which needs none of the client-only Firebase fields — would fail to even load if a single client-only variable (e.g. `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`) were missing from the environment Next.js was building in.

This coupling has existed since Phase 1B (`admin.ts`'s creation) and would have caused the identical failure at any prior phase's Production deploy under the same missing-variable condition. Phase 6 did not introduce it, weaken it, or touch `admin.ts`/`client-env.ts` at all.

**Corrected finding (superseding an earlier, disproven theory in this doc):** an initial hypothesis was that Vercel's Preview scope had the required `NEXT_PUBLIC_FIREBASE_*` variables set and only Production was missing them. That is **not** what the evidence shows. Checking the "Vercel" GitHub status check (distinct from this repo's own `build-and-test` CI check) on both PR #6 (commit `d58809c`, merged to `main` and the direct cause of the reported Production failure) and PR #7 (this hotfix, commit `376d6a3`) shows **Preview deployments failing on both**, with the same error class. This means the required client variables are most likely missing from Vercel's project configuration entirely — not scoped only to Production — and is a Vercel environment-variable configuration action independent of any code change.

**Exact import chain that triggers validation during `next build`'s "Collecting page data" step** (traced concretely, before the fix):
```
src/app/api/webhooks/[connectorId]/route.ts:3
  import { handleWebhook } from "@/platform";
    -> src/platform/index.ts:24  (re-exports handleWebhook)
      -> src/platform/connector-connections/connector-connection.service.ts:148
           export async function handleWebhook(...)
         same file, line 5:
           import { adminDb } from "@/lib/firebase/admin";
             -> src/lib/firebase/admin.ts
                (before the fix) line 7: import { clientEnv } from "@/shared/config/client-env";
                  -> src/shared/config/client-env.ts:26
                       export const clientEnv = parseClientEnv(process.env);  // module-level, runs at import time
                       -> throws at client-env.ts:19-21 if any of the 6 required fields fails Zod validation,
                          with the exact missing key names interpolated into the thrown message
```
Next.js statically imports each route's module graph during page-data collection, which executes this chain at build time, before any request is served. After the fix, `admin.ts` no longer imports `client-env.ts`, so this chain cannot throw regardless of which client-only variable is missing.

A full-repo grep (`grep -rn "process\.env" src/ --include="*.ts" --include="*.tsx"`, excluding tests) confirms **no file outside `client-env.ts` and `server-env.ts` reads `process.env` directly** — every environment variable used anywhere in the app is funneled through one of these two schemas, so the audit in §4 is exhaustive.

## 3. Fix

`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` is now also validated by `serverEnv` (`src/shared/config/server-env.ts`) — the exact same variable, same value, read via the server-only schema instead of the client one:

```ts
// server-env.ts
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),

// admin.ts
storageBucket: serverEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
```

`admin.ts` no longer imports `clientEnv` at all. This does not weaken any validation: the bucket name is still required, still validated, still fails fast if missing — it is simply validated by the schema that actually owns the one thing a server-only module needs, independent of the five other, purely browser-facing fields (`API_KEY`, `AUTH_DOMAIN`, `MESSAGING_SENDER_ID`, `APP_ID`, `MEASUREMENT_ID`) that a server-only path has no relationship to.

**What this does not fix, and does not claim to fix:** `core/auth/identity-toolkit.ts` (sign-in/sign-up) genuinely needs `NEXT_PUBLIC_FIREBASE_API_KEY` server-side (the Identity Toolkit REST API requires it), and `src/lib/firebase/client.ts`/`config.ts` (the browser bundle, including Kitchen Display's realtime feed) genuinely need all six client variables. If any of those are still missing in Vercel Production, sign-in and/or the realtime feed will still fail — correctly, since they are truly mandatory for those specific features. This fix's scope is exactly what it claims: an unrelated, purely-server-side path (and everything else that only touches `adminDb`/`adminAuth`/`adminStorage`) can no longer be taken down by a client-only variable it never needed.

## 4. Complete environment variable audit (Phases 1–6)

| Variable | Schema | Required/Optional | Side | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | clientEnv (required) + serverEnv (indirectly, via `identity-toolkit.ts` importing clientEnv) | **Required** | Client + Server | Client SDK init; also used server-side for Identity Toolkit REST calls (sign-in/sign-up). Not a secret — Firebase Web API keys are meant to be public. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | clientEnv (required) | **Required** | Client only | Client SDK init only. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | clientEnv (required) | **Required** | Client only | Client SDK init only. Distinct from server-side `FIREBASE_PROJECT_ID` (same value in practice, separate variable name/schema). |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | clientEnv (required) **and now serverEnv (required, this hotfix)** | **Required** | Client + Server | Client SDK init; now also directly validated server-side for `adminStorage` init, decoupled from the other five client fields. |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | clientEnv (required) | **Required** | Client only | Client SDK init only. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | clientEnv (required) | **Required** | Client only | Client SDK init only. |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | clientEnv (optional) | Optional | Client only | Analytics; already optional, unaffected by this fix. |
| `FIREBASE_PROJECT_ID` | serverEnv (required) | **Required** | Server only | Admin SDK service account. |
| `FIREBASE_CLIENT_EMAIL` | serverEnv (required) | **Required** | Server only | Admin SDK service account. |
| `FIREBASE_PRIVATE_KEY` | serverEnv (required) | **Required** | Server only | Admin SDK service account. Never logged, never exposed to client. |
| `ANTHROPIC_API_KEY` | serverEnv (optional) | Optional, feature-specific | Server only | AI Assistant App only (Phase 6). Confirmed: absence never breaks the build or any other route — `llm-client.ts` only throws `AiAssistantNotConfiguredError` at the moment a question is actually asked, not at module load. |

**Variables NOT read from `process.env` anywhere in the codebase** (confirmed by a full-repo grep outside the two schema files) for Shopify, Square, Odoo, WhatsApp, and Google Secret Manager: these are all **per-company, Firestore-stored connection config** (`companies/{companyId}/connectors/{connectorId}` / `companies/{companyId}/notificationChannels/whatsapp`), entered through Settings UI at runtime, not deployment-time environment variables at all. Secret Manager's client (`platform/secrets/client.ts`) reuses the already-validated `serverEnv.FIREBASE_*` credentials directly — it requires no separate environment variable and cannot fail to construct for a reason unrelated to those three already-required Firebase Admin variables (a real API call to Secret Manager can still fail at *use* time, e.g. missing IAM permissions, but that never blocks a build or any unrelated route, since it is only ever invoked from an explicit Settings action, never at module load).

**Conclusion: no optional integration (Anthropic, WhatsApp, Shopify, Square, Odoo, Secret Manager) can break the build when intentionally unconfigured.** The only two variables capable of breaking a build if missing are the ones that were always fundamentally required — Firebase project identity and credentials — and after this fix, a missing *client-only* Firebase field can no longer collaterally break purely server-side routes that never needed it.

## 5. Required Vercel environment variables (complete list)

Given the Vercel Preview deployment check (distinct from this repo's own `build-and-test` CI check) failed on **both** PR #6 and PR #7 with the same error class, these variables are very likely missing from Vercel's project configuration across **both Preview and Production** scopes, not Production alone. The following nine must be set for both scopes in Vercel (Project Settings → Environment Variables → check both "Production" and "Preview"):

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

**This is a Vercel dashboard configuration action, not something fixable in code.** An attempt to configure these directly from this session found no path to do so: no Vercel API/CLI credentials are present anywhere in the environment (`npx vercel whoami` reports no existing credentials, and the interactive login flow cannot complete headless), and separately, the sandbox's outbound network policy hard-denies `vercel.com`, `api.vercel.com`, and `telemetry.vercel.com` at the gateway (403 on CONNECT) regardless of credentials. Setting these variables requires a human with access to the Vercel dashboard for this project.
(`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` is optional; `ANTHROPIC_API_KEY` is optional, only needed if the AI Assistant App will be used in production.)
