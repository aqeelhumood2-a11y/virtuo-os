# Phase 5 — Real External Connectors (implemented)

Status: **implemented**, as one complete phase per explicit instruction (no sub-phase split). This is the as-built record; see the architecture proposal discussion in the implementation history for the earlier, rejected recommendation to split this into sub-phases 5.1a–5.1d.

## 1. Goals

Ship real, working connectors — not stubs — for the roadmap's Phase 5 milestone: "At least one connector syncing real external data bidirectionally in production." Three connectors are built this phase: **Shopify**, **Square**, and **Odoo** (the roadmap's Phase 5.3 slot, see §4 below for why Odoo specifically). Each is a genuine HTTP/JSON-RPC adapter against the real external API — the only reason one wouldn't work end-to-end in production is the absence of real, live credentials, never stubbed logic.

## 2. Scope

**In scope:**
- Real `connect()`/`sync()`/`disconnect()`/`onWebhook()` implementations for Shopify, Square, and Odoo.
- Inbound sync: pull the external system's product catalog into Core's Inventory Item catalog.
- Outbound sync: push Core's own completed orders to the external system, sufficient to satisfy "bidirectional."
- Secure credential storage via Google Secret Manager (no plaintext credential ever reaches Firestore).
- Product and order mappings, keyed for idempotency and race-safety.
- Error handling: per-order failure isolation (a bad line item never aborts the whole sync), auth failures surfaced as clear messages.
- Audit logging (`connector.synced`), reusing Core's existing generic audit mechanism.
- Required Firestore rules for the new mapping collections.

**Out of scope (see §6 and §10 for the reasoning behind each):**
- Stock-quantity write-back into Core's per-branch `stock` collection (informational only, on the mapping doc).
- Inbound order import (an external order becoming a new Core order).
- OAuth authorization-code flows (access-token-only auth this phase).
- Webhook-subscription creation on the external system (sync is on-demand/lazy, matching every prior phase's precedent).
- SAP and Oracle connectors (see §4).
- Any change to Restaurant, Retail, or Loyalty.

## 3. Approved Instruction and How It Was Interpreted

The approved instruction required, verbatim: a Shopify connector, a Square connector, "Odoo/SAP/Oracle connector scope defined in the roadmap," real external data synchronization, bidirectional synchronization sufficient to satisfy the milestone, secure credential storage, and required permissions/mappings/error handling/idempotency/audit/documentation — implemented as one complete phase, no splitting, preserving all existing layer boundaries, no Restaurant/Retail/Loyalty changes unless additive and documented.

One clause needed reconciling rather than guessing: the roadmap's own Phase 5.3 text does not define concrete Odoo/SAP/Oracle scope — it explicitly defers it ("implemented in priority order once you tell us which businesses need which first," `docs/ROADMAP.md`). Rather than ask a further clarifying question (already declined once this phase) or arbitrarily guess a specific SAP or Oracle module's API shape, Odoo was picked as the one ERP connector built this phase, and the reasoning is documented transparently below (§4) instead of narrowed silently.

## 4. Why Odoo, Not SAP or Oracle

Odoo, SAP, and Oracle are not interchangeable integration targets. Odoo has one public, self-hostable, uniformly-documented external API (`/jsonrpc`, `common.authenticate` + `object.execute_kw`) that any Odoo installation exposes the same way. SAP (OData services or RFC, tenant- and module-specific — S/4HANA vs. ECC alone differ) and Oracle (REST, similarly tenant/module-specific — Fusion Cloud vs. E-Business Suite differ) each require a specific customer's tenant configuration, module set, and often a bespoke integration user/contract to build against at all. Building a "SAP connector" or "Oracle connector" without that input would not be a real integration — it would be a guess dressed up as one, which the approved scope explicitly does not want ("no stubbed logic"). The roadmap itself defers this exact decision to a future business-priority signal. Odoo is therefore the one ERP connector built this phase; SAP and Oracle remain Backlog until that signal exists (see §11).

## 5. Credential Storage: Google Secret Manager

`docs/DATABASE.md` §5 established the shape ahead of time: a connection doc holds only an opaque `credentialRef`, never a credential. This phase makes that real:

- New `platform/secrets` module (`client.ts`, `secret.service.ts`) wraps `@google-cloud/secret-manager`.
- The Secret Manager client reuses the **exact same GCP service-account credentials** already validated for Firebase Admin (`FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`) — a Firebase project's service account is a GCP service account. No new secret or env var is introduced.
- `storeConnectorCredential(companyId, connectorId, secretValue)`: creates the secret (`connector-{companyId}-{connectorId}`) on first use, adds a new version, returns the version's resource name as the `credentialRef` Platform persists.
- `resolveConnectorCredential(credentialRef)`: reads the plaintext value back, only ever at the moment `syncConnector` needs to call the external API.
- `deleteConnectorCredential(companyId, connectorId)`: called on disconnect, **only when a credential was actually stored** (a connector with nothing secret to hold never touches Secret Manager at all — this also keeps the emulator test suite, which has no live Secret Manager access, from ever needing one).

A connector's `connect()` returns an optional plaintext `credential` (moved into Secret Manager by Platform, never persisted to Firestore) and `safeConfig` (the non-secret fields Platform persists directly) — only the connector itself knows which of its own config fields are secret.

## 6. Data Model

```
companies/{companyId}/connectors/{connectorId}                        # unchanged shape from Phase 2
  status, lastSyncAt, credentialRef?, config?

companies/{companyId}/connectors/{connectorId}/productMappings/{externalId}   # new, Platform-owned
  itemId (Core's own InventoryItem id), externalQuantity? (informational only), lastSyncedAt

companies/{companyId}/connectors/{connectorId}/outboundOrderMappings/{orderId} # new, Platform-owned
  status: "reserved" | "pushed", externalOrderId?, reservedAt, pushedAt?
```

**Why stock-quantity write-back is out of scope:** Core's `InventoryItem` catalog is company-wide, but `Stock` (`quantityOnHand`) is per-branch. An external product has no branch of its own in this design — guessing which branch an external system's stock count belongs to would be exactly the kind of unjustified Core-adjacent assumption the approved scope forbids. The externally reported quantity is recorded on the `productMappings` doc for visibility only; it is never written into Core's `stock` collection. This is a deliberate, documented boundary, not an oversight — the same kind of considered trade-off Loyalty's late-attribution limitation was.

**Why inbound order import is out of scope:** creating a real Core order from an arbitrary external order would require resolving a branch and (Core has no concept of) a customer/partner — decisions this phase has no basis to make generically across three different external systems. Outbound-only order sync (Core → external) is what this phase builds; it is still genuinely bidirectional together with inbound product sync (external → Core).

## 7. Idempotency and Concurrency Safety

- **Products:** `productMappings/{externalId}` is the upsert key — a product already mapped updates the existing Core Item; it never creates a duplicate.
- **Orders:** `outboundOrderMappings/{orderId}` is both the idempotency guard and the race guard. Before an order is ever included in a sync run's outbound batch, `reserveOutboundOrder` performs a transactional create-if-absent check — if the doc already exists (pushed by a prior run, or reserved by a *concurrent* run), the order is skipped. This prevents two simultaneous "Sync Now" clicks from both pushing the same order to the external system twice.
- A reservation the connector could not actually push (e.g. Odoo found no matching product for a line's SKU) is released, not left stuck — a later sync retries it. A reservation the connector silently drops (returns neither in `pushedOrders` nor `failedOrderIds`) is released the same way, so nothing is ever permanently blocked by a connector bug.
- A sync run's batch is bounded (`SYNC_ORDER_BATCH_SIZE = 50`), the same "cap every run's scan cost" precedent Loyalty's `SYNC_PAGE_SIZE` established.

## 8. Sync Model: On-Demand, Not Event-Driven

Consistent with every prior phase's decision against new background infrastructure (Loyalty's §13.1: no Cloud Functions, Cloud Scheduler, or background workers), sync is triggered by an explicit "Sync Now" action in Settings. No connector calls any external system's webhook-subscription-creation API this phase — `onWebhook()` still exists on the contract and the route still works if a subscription is configured manually outside the app, but nothing in this phase wires that up automatically. This is a deliberate, documented boundary, not a gap: introducing a new event/scheduling mechanism was explicitly out of scope for prior phases and nothing in the Phase 5 instruction reversed that.

## 9. Permissions

**Zero new capabilities anywhere.** Every operation reuses Platform's existing `connectors.manage` (connect/disconnect/sync — mutating) and `connectors.view` (read connection/mapping state), the same matrix Phase 2 established (`Owner` only for `.manage`). Settings' `connectConnectorAction` accepts a connector-agnostic `configJson` blob (parsed and forwarded untouched) rather than per-connector-shaped form fields — Settings never hardcodes any one connector's config shape, the same "submit one JSON blob, validate server-side" idiom Retail's `checkoutAction` established for its own cart.

## 10. Architecture

```
Core (order-engine, inventory-engine)     — unchanged; read via listOrdersForBranch/
                                              listOrderLines/getItem/createItem/updateItem/listBranches
   ▲
Platform/connector-connections            — connectConnector (+ credential storage),
                                              disconnectConnector, syncConnector (new),
                                              product-mapping.repository, order-mapping.repository
   ▲                                          (new)
Platform/secrets (new)                    — Secret Manager wrapper
   ▲
Connectors: shopify, square, odoo (new)   — pure HTTP/JSON-RPC adapters, zero Firestore/Core/Platform import
   ▲
Settings/connectors-management            — configJson input, Sync Now button
```

No new Core capability, no new Platform capability, no change to Restaurant/Retail/Loyalty. `ConnectorContract` itself gained additive fields only (`credential`/`safeConfig` on connect's result; `products`/`pushedOrders`/`failedOrderIds` on sync's result; `sync(params?)` now optionally takes `{ credential, config, outboundOrders }`) — every existing caller (the Phase 2 `custom-api` stub, its tests, the registry's own fake-connector test) still compiles and passes unmodified, since `params` and every new field are optional.

## 11. Backlog (explicitly not built this phase)

- SAP and Oracle connectors, once a real business priority signal exists (roadmap's own deferral).
- OAuth-based connector authorization (currently access-token/API-key only).
- Stock-quantity write-back into Core's per-branch `stock` collection.
- Inbound order import (external order → new Core order).
- Automatic webhook-subscription creation on the external system.
- A partner/customer mapping for Odoo's pushed orders (currently attached to Odoo's own seeded "Public user" partner, id 1).
- Event-driven/scheduled sync (Cloud Functions/Scheduler), if a business need for near-real-time sync ever outweighs the operational simplicity of on-demand sync.

## 12. Testing

- **Unit:** every connector (`shopify`, `square`, `odoo`) with `fetch` mocked — connect success/failure, product normalization, order push success/failure/skip paths. `platform/secrets` with `@google-cloud/secret-manager` mocked. `product-mapping.repository`/`order-mapping.repository` with the established nested-Firestore-mock convention. `connector-connection.service.ts`'s `connectConnector`/`disconnectConnector`/`syncConnector` with every dependency mocked, including the reservation-release-on-failure and silently-dropped-reservation paths. Settings' `actions.ts` for the `configJson` parse/validation paths and the new `syncConnectorAction`.
- **Emulator:** a test-only fake connector (no credential, no real network) registered directly into the real connector registry proves the real Firestore transactions: a completed order gets pushed and mapped exactly once, a re-sync doesn't re-push it or duplicate the Core Item, and the `connector.synced` audit entry is written. A `ConnectorNotConnectedError` test confirms syncing a never-connected connector fails cleanly.
- **Security rules:** `productMappings`/`outboundOrderMappings` — any active member can read, every write is `if false` (Admin-SDK-only via `syncConnector`).
- **Architecture:** the existing zone-level import-boundary rules (`src/connectors/**/*`, `src/platform/**/*`) already cover every new file with no changes needed — Connectors remain isolated from Core/Apps/Platform, Platform remains the only importer of Connectors.

## 13. Estimated Files (actual)

New (~20): `src/connectors/{shopify,square,odoo}/connector.ts` (+3 tests), `src/platform/secrets/{client,secret.service,index}.ts` (+1 test), `src/platform/connector-connections/{product-mapping,order-mapping}.repository.ts` (+2 tests), `src/platform/connector-connections/connector-connection.sync.emulator.test.ts`, this plan doc.

Modified (~14): `src/connectors/{connector-contract.types.ts, index.ts, registry.ts, registry.test.ts, custom-api/connector.ts}`, `src/platform/connector-connections/{connector-connection.types.ts, connector-connection.service.ts, connector-connection.service.test.ts, index.ts}`, `src/platform/index.ts`, `src/settings/connectors-management/{actions.ts, actions.test.ts, ConnectorsList.tsx}`, `firestore.rules`, `tests/security-rules/platform.test.ts`, `package.json`, `docs/{ARCHITECTURE.md, ROADMAP.md, DATABASE.md}`, `src/connectors/README.md`, `src/settings/README.md`.
