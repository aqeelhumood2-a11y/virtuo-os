# Connectors

Isolated external integrations. `connector-contract.types.ts` defines `ConnectorContract` (connect/disconnect/sync/onWebhook); `registry.ts` performs compile-time registration of every known connector. Phase 2 adds exactly one stub, `custom-api`, proving the contract shape end-to-end with zero real external system — no real integration exists until Phase 5.

Every method on a Connector is pure: receive input, validate, normalize, return output. A Connector must never import Core, Platform, App Registry, or any Firestore repository — all state, persistence, and orchestration live in `platform/connector-connections`, the only module permitted to import this one. See `docs/phases/PHASE_2_PLAN.md` §2/§4/§5.

Import-boundary rule: Connectors must remain isolated — no dependency on Core, Platform, App Registry, or Apps.
