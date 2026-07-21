# Connectors

Isolated external integrations. `connector-contract.types.ts` defines `ConnectorContract` (connect/disconnect/sync/onWebhook); `registry.ts` performs compile-time registration of every known connector. Phase 2 added exactly one stub, `custom-api`, proving the contract shape end-to-end with zero real external system. Phase 5 (see `docs/phases/PHASE_5_PLAN.md`) adds the first three real connectors: `shopify` (Admin REST API), `square` (REST API), and `odoo` (JSON-RPC external API) — each a genuine HTTP adapter with no stubbed behavior, gated only by needing real, live credentials to actually reach the external system.

Every method on a Connector is pure: receive input, validate, normalize, return output. A Connector must never import Core, Platform, App Registry, or any Firestore repository — all state, persistence, and orchestration (capability checks, audit logging, credential storage, Core writes) live in `platform/connector-connections`, the only module permitted to import this one. See `docs/phases/PHASE_2_PLAN.md` §2/§4/§5 and `docs/phases/PHASE_5_PLAN.md`.

`connect()` validates the submitted config against the real external API and returns an optional plaintext `credential` (moved into Secret Manager by Platform, never persisted to Firestore) and `safeConfig` (the non-secret fields Platform may persist directly). `sync(params)` receives the resolved credential/config plus a bounded batch of Core orders to push outward, and returns any discovered `products` (inbound) alongside any successfully `pushedOrders`/`failedOrderIds` (outbound) — see each connector's own file for its specific normalization.

SAP and Oracle (roadmap Phase 5.3's other two named ERPs) are not built this phase: the roadmap itself defers their priority ("implemented in priority order once you tell us which businesses need which first"), and each is a tenant- and module-specific enterprise integration that can't be built generically without that input — see `odoo/connector.ts`'s header comment and `docs/phases/PHASE_5_PLAN.md` §4.

Import-boundary rule: Connectors must remain isolated — no dependency on Core, Platform, App Registry, or Apps.
