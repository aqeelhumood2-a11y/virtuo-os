# Phase 6 — Advanced Apps (implemented)

Status: **implemented**, as one complete phase per explicit instruction (no sub-phase split). This is the as-built record; see the architecture proposal discussion in the implementation history for the full options considered before implementation.

## 1. Goals

Ship all four roadmap items in one phase: **Kitchen Display** (6.1), **Barcode** (6.2), **WhatsApp notification channel** (6.3), and **AI Assistant** (6.4). Three are new Apps, built exactly the way Restaurant/Retail/Loyalty were — zero change to App Registry's mechanism, Platform's install/entitlement machinery, or any existing App. The fourth (WhatsApp) is a second `core/notifications` channel, exactly as `ARCHITECTURE.md` anticipated in Phase 1G.

## 2. Scope

**In scope:** a realtime Kitchen Display board; scan-to-lookup/scan-to-sell for Barcode; a real WhatsApp Business Cloud API channel mirroring admin notifications; a read-only AI Assistant grounded in Core's own already-authorized reads.

**Out of scope (documented per sub-feature below):** any change to Restaurant/Retail/Loyalty's own code; SAP/Oracle-equivalent scope creep; a customer-facing chat; write access for the AI Assistant; per-recipient WhatsApp preferences; a `scanLogs` audit trail for Barcode (Backlog).

## 3. 6.1 — Kitchen Display

**The core finding that shaped this feature:** the client-side Firebase SDK (`src/lib/firebase/client.ts`) had existed since Phase 1A but was never used for anything beyond scaffolding — sign-in has always gone through a server-side Identity Toolkit call + an httpOnly session cookie (`core/auth/identity-toolkit.ts`, `core/auth/session.ts`), so the browser never held a Firebase Auth ID token. A client-side `onSnapshot` listener would therefore have `request.auth == null` and be correctly denied by every existing rule — there was no gap to fix, just no client identity yet for the rules to evaluate.

**Resolution:** `core/auth/session.ts` gained one new, minimal function, `mintClientAuthToken()` — mints a Firebase custom token (`adminAuth.createCustomToken`) from the caller's own already-verified server session, carrying only `uid` and a mirrored `superAdmin` claim (role/branchIds are deliberately not embedded — every rule that needs them already reads the membership document directly, the same source of truth server reads use, never a second cacheable copy that could go stale after a role change). Exposed as `mintClientAuthTokenAction` (`core/auth/actions.ts`). Kitchen Display's `KitchenBoard.tsx` (a Client Component) calls this once per mount, then `signInWithCustomToken(auth, token)` against the existing (previously dormant) client Firebase Auth instance — after which `onSnapshot` against `companies/{companyId}/orders` and `companies/{companyId}/apps/kitchen-display/prepStatus` works, gated entirely by the existing Firestore rules, **with zero rule changes**.

**A new precedent, stated explicitly:** this is the first Client Component in the codebase to read Firestore directly rather than through a Server Component/Action. The rule is: a Client Component may read (never write) an existing Core-owned collection's already-established shape via the client SDK, with authorization enforced entirely by `firestore.rules` — every write still goes exclusively through a Server Action. `firestore.rules`' `prepStatus` block documents this explicitly.

**One important build-time lesson:** a Client Component must import a Server Action directly from the file where it's declared (`@/core/auth/actions`, which has its own `"use server"` directive), never through the general `@/core` barrel — importing a runtime value (not just a `import type`) through that barrel pulls the entire server-only module graph (`firebase-admin`, `@google-cloud/secret-manager`, etc.) into the client bundle. Every existing client component only ever imported *types* from `@/core`; this phase is the first to need a runtime value, and got the import path wrong on the first pass — caught by `next build`, not by lint/typecheck/unit tests, underscoring why the production build is part of this project's required validation, not an optional last step.

**Data model (new, App-owned only):**
```
companies/{companyId}/apps/kitchen-display/prepStatus/{orderId}
  branchId, stage: "queued" | "preparing" | "ready", updatedBy
```
Core's own `OrderStatus` (`pending`/`completed`/`voided`) is unchanged and remains the sole source of truth for the business transaction; prep stage is a Kitchen-Display-only concept layered on top, the same pattern Restaurant's `orderMeta` established for App-specific fields Core cannot own.

**Permissions:** reuses Core's existing `orders.view` (read the feed, via `getOrder`'s own branch-access enforcement) and the FRONTLINE tier's `orders.complete` (advance stage) — zero new Core or Platform capability.

## 4. 6.2 — Barcode

**One small, justified Core addition:** `InventoryItem` gained an optional `barcode?: string` field (`domain/types.ts`, `CreateItemInput`/`UpdateItemInput`), plus one new read, `getItemByBarcode(companyId, barcode)` (a single-field equality filter, served by Firestore's automatic index — no composite declared). This is genuinely business-agnostic, the same tier as `sku`/`unit`/`category` — deliberately distinct from `sku`, since a barcode (the physical UPC/EAN symbology a scanner reads) frequently differs from an item's own internal catalog code; reusing `sku` for this would have conflated two different concepts.

**Everything else is additive-only, in the App itself:** `src/apps/barcode` mirrors Retail's own shape almost exactly — `lookupByBarcode` is a thin wrapper around `getItemByBarcode`; `quickSale` is a thin wrapper around Core's `createOrder` with `appId: "barcode"`, reusing the exact same `idempotencyKey` mechanism Retail's `createSale` established. No App-owned collection (a `scanLogs` audit trail was considered and left to Backlog, matching Retail's own "no collection needed" precedent when there's no data Core doesn't already model). Barcode does not import Retail's `sale.service.ts` — Apps don't import each other's internals — it duplicates the small, stable cart/checkout shape independently.

**Permissions:** reuses `inventory.view` (lookup) and `orders.create`/`orders.complete` (quick sale) — zero new capability.

## 5. 6.3 — WhatsApp Notification Channel

**Not a Connector.** Connectors sync external *business* data (Shopify/Square/Odoo); this is a delivery mechanism for notifications Core already generates — exactly the boundary `core/notifications` was designed to extend into (`ARCHITECTURE.md`: "channel-agnostic — in-app now, email/SMS/WhatsApp later via the same interface").

**The real design tension, and how it resolved differently than the architecture proposal sketched:** the proposal considered wiring WhatsApp directly into `createNotification`/`createNotificationInTransaction`'s existing dispatch point. That turned out to be architecturally impossible without a boundary violation: resolving a company's WhatsApp connection/credential requires `platform/secrets` and `platform/notification-channels`, and **Core must never import Platform** — the oldest, most consistently enforced rule in this codebase. Apps can't bridge this either (Apps must not import Platform directly). The actual, boundary-respecting design:

- `core/notifications/channels/whatsapp.ts` — a second, pure channel implementation (`sendWhatsAppMessage`, `verifyWhatsAppCredential`), taking a plain `{ phoneNumberId, accessToken, toPhoneNumber }` config as a parameter. It never resolves anything itself, the same "pure adapter, caller owns state" boundary Phase 5's Connectors established. Exported as a plain utility from `core/notifications`, but **nothing in Core calls it automatically** — `createNotification`/`createNotificationInTransaction` are completely unchanged.
- `platform/notification-channels` (new) — owns the connection (`connectWhatsAppChannel`/`disconnectWhatsAppChannel`, reusing `platform/secrets` as-is for the access token) and a **lazy, on-demand sync** (`syncWhatsAppNotifications`) that *pulls* from Core's own already-durable per-user notification records — the exact same "walk backward via cursor pagination until you hit last time's cursor" mechanism Loyalty's `syncAccruals` established, just applied to `listNotificationsPage` instead of Core's audit log. For each of the company's Owner/Manager admins, it scans their own notification inbox for anything new since that admin's own stored cursor, and forwards each to the one configured company-wide WhatsApp destination number.
- This mirrors admin notifications broadly (whatever an Owner/Manager already receives in-app) rather than requiring a per-call-site retrofit of Restaurant/Retail/Loyalty's existing notification-producing code — **zero lines changed in any of those three Apps.**

**Delivery guarantee:** the per-admin cursor advances once **per notification**, immediately after each send attempt (success or failure) — not once after the whole batch. This bounds a process crash's exposure to at most the single message in flight at the instant of the crash, never the rest of an already-delivered batch. Meta's Cloud API exposes no send-side idempotency key (unlike Square's, reused in Phase 5), so this is an honest **at-least-once, single-message-bounded** guarantee, not exactly-once — stated plainly rather than overclaimed. A message that fails to send has its cursor advanced anyway (not retried indefinitely), the same "don't let one permanently-failing item block everything behind it" precedent as Loyalty's attribution design. Because `syncWhatsAppNotifications` only ever reads Core's *already-committed* notification records (via `listNotificationsPage`, called well after the originating transaction — `createNotificationInTransaction` — has committed), a WhatsApp delivery failure can never block or roll back the business transaction that produced the notification; the two are temporally and transactionally disjoint by construction, not by a try/catch bolted on afterward.

**Why one company-wide destination number, not per-user preferences:** Meta's Cloud API sends to one recipient phone number per message; a genuine per-user preference system would need a phone number on every user's own profile (a `core/users` change) and an opt-in flag — meaningfully more invasive than the roadmap item calls for. A single company-wide WhatsApp line receiving mirrored admin notifications is a legitimate, honestly-scoped v1, and fits Restaurant/Retail's own existing "notify the other Owners/Managers" broadcast pattern naturally.

**Data model (new, Platform-owned):**
```
companies/{companyId}/notificationChannels/whatsapp
  status, lastSyncAt, credentialRef?, config: { phoneNumberId, toPhoneNumber }

companies/{companyId}/notificationChannels/whatsapp/cursors/{uid}
  lastNotificationId   -- internal bookkeeping only, one per admin scanned
```

**Permissions:** one new, precisely-named Platform capability, `notificationChannels.manage` (Owner-only, same tier as `connectors.manage`) — deliberately not a reuse of `connectors.manage` itself, since WhatsApp isn't a connector and overloading that capability's name would be confusing; Platform's own capability vocabulary is explicitly designed to be extended this way, one commercial concept at a time, unlike Core's frozen-unless-justified matrix.

## 6. 6.4 — AI Assistant

**Read-only, by hard boundary.** The Assistant never touches Firestore, Core, or Platform directly for its answer generation — it only ever sees a bounded, plain-text snapshot of data gathered by calling Core's own already-capability-gated reads (`listOrdersForBranch`, `listItems`, `listStockForBranch`, and — only if the asking user already has `audit.view`, checked as a plain boolean with no redirect, the same precedent Loyalty's `LoyaltyAppRoot` established — `listAuditLogsPage`) as the real asking user. It never gains any access a user didn't already have through the existing UI; it's a new way to *ask* for data, not a new grant of it.

**The one genuinely new piece of infrastructure:** an LLM API call is inherent to "AI Assistant," not a scope choice. `src/apps/ai-assistant/application/llm-client.ts` wraps `@anthropic-ai/sdk` (model: `claude-sonnet-5`), using a single **platform-wide** API key (`ANTHROPIC_API_KEY`, optional in `server-env.ts` so its absence never breaks any other environment) rather than a per-company Secret-Manager-backed credential like a Connector's — one Virtuo-OS-operated subscription serves every company, since there's no per-company external account to connect (unlike Shopify/Square/Odoo/WhatsApp).

**Accountability record:** `companies/{companyId}/apps/ai-assistant/queryLog/{logId}` (`question`, `answer`, `actorId`) is written after every answered question — best-effort (a failed write never blocks returning the answer, the same tier as Loyalty's `syncCursor`), never read by the LLM itself.

**Permissions:** zero new capability anywhere. Access to the App itself is already gated by Platform's existing generic install/entitlement mechanism (same as every other App); every underlying read is gated by that read's own pre-existing Core capability check.

## 7. Architecture

```
Core: inventory-engine (barcode field + read), auth (custom-token mint),
      notifications (WhatsApp channel, pure)          -- additive only
   ▲
Platform: secrets (reused as-is), notification-channels (new)  -- unchanged
   ▲                                                              elsewhere
App Registry            -- 3 more registerApp() calls (barcode, kitchen-display, ai-assistant)
   ▲
Apps: barcode, kitchen-display, ai-assistant (new)     -- restaurant/retail/loyalty untouched
   ▲
Settings: notification-channels-management (new section)
   ▲
Next.js route layer: 3 more routeKey entries; the first-ever
                      Client-Component-reads-Firestore-directly pattern
```

No new Core capability in `roles-permissions`. One new Platform capability (`notificationChannels.manage`). No change to Restaurant, Retail, or Loyalty's own code.

## 8. Testing

- **Unit:** every new Core addition (`getItemByBarcode`, `mintClientAuthTokenAction`'s underlying `mintClientAuthToken`, the WhatsApp channel with `fetch` mocked), the new Platform module (repository + service, including the reservation/cursor-walk/failure-isolation paths), all three new Apps' services/actions, the new Settings section's actions.
- **Emulator:** Kitchen Display (`listQueueForBranch`/`advanceStage` against real completed/voided orders), Barcode (`getItemByBarcode` against a real seeded item, a real concurrent-`quickSale`-with-the-same-draftId idempotency proof), WhatsApp (`connectWhatsAppChannel`→`syncWhatsAppNotifications` against a real seeded notification, proving one message sent and idempotent on re-sync — with `platform/secrets` and the WhatsApp Cloud API's own `fetch` calls faked, the same "fake only the one non-Firestore boundary" precedent Phase 5 established), AI Assistant (`answerQuestion` grounded in real seeded stock/audit data, with only the LLM call faked).
- **Security rules:** `prepStatus` (branch-scoped, mirrors `orderMeta`), `notificationChannels` + its `cursors` subcollection (mirrors `connectors` + `syncCursor` tiers), `queryLog` (mirrors Loyalty's company-wide tier).
- **Architecture:** the existing zone-level import-boundary tests already cover every new file under `src/apps/**`, `src/core/**`, `src/platform/**`, `src/settings/**` with zero changes needed.

## 9. Backlog (explicitly not built this phase)

- Barcode's `scanLogs` audit trail.
- Per-user WhatsApp phone numbers/opt-in preferences (would require a `core/users` change).
- Automatic WhatsApp webhook-subscription creation (inbound replies) — sync remains on-demand, consistent with every prior phase's decision against new background infrastructure.
- Per-company, bring-your-own LLM API key for the AI Assistant.
- Extending the AI Assistant beyond orders/inventory/audit (e.g. Loyalty data).

## 10. Estimated Files (actual)

New (~38): `src/core/notifications/channels/{whatsapp.ts,whatsapp.test.ts}`; `src/platform/notification-channels/*` (7 files); `src/apps/barcode/*` (9 files); `src/apps/kitchen-display/*` (10 files); `src/apps/ai-assistant/*` (12 files); `src/settings/notification-channels-management/*` (4 files); `tests/security-rules/{kitchen-display,ai-assistant}.test.ts`; this plan doc.

Modified (~16): `src/core/{index.ts, auth/{session.ts,actions.ts}, inventory-engine/{domain/types.ts, infrastructure/refs.ts, application/items.ts, application/items.test.ts}, index.ts (notifications section)}`; `src/platform/{index.ts, shared/require-platform-capability.ts, shared/require-platform-capability.test.ts}`; `src/app-registry/{registry.ts, registry.test.ts}`; `src/app/(dashboard)/[companyId]/apps/[appId]/[[...slug]]/app-roots.ts`; `src/app/(dashboard)/[companyId]/settings/[[...slug]]/page.tsx`; `src/settings/index.ts`; `firestore.rules`; `tests/security-rules/platform.test.ts`; `package.json`; `.env.example`; `docs/{ARCHITECTURE.md,ROADMAP.md,DATABASE.md}`; `src/{apps,settings}/README.md`.
