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

This coupling has existed since Phase 1B (`admin.ts`'s creation) and would have caused the identical failure at any prior phase's Production deploy under the same missing-variable condition. Phase 6 did not introduce it, weaken it, or touch `admin.ts`/`client-env.ts` at all — it simply appears to be the first Production deploy where a required `NEXT_PUBLIC_FIREBASE_*` variable was absent from Vercel's Production environment scope (Vercel scopes variables per Production/Preview/Development independently; Preview builds for every prior PR succeeded, which is consistent with Preview having them set while Production did not).

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

## 5. Required Vercel Production environment variables (complete list)

If Production variables are the only gap (this is the most likely explanation — see §2), the following ten must be set for the **Production** environment scope in Vercel (Project Settings → Environment Variables → ensure "Production" is checked, not only "Preview"/"Development"):

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
(`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` is optional; `ANTHROPIC_API_KEY` is optional, only needed if the AI Assistant App will be used in production.)
