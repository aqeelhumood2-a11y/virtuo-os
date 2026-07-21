// Google Secret Manager-backed credential storage for Connectors -- the
// only module that ever holds a plaintext connector credential in memory,
// and only for the instant it's stored or resolved. Never imported by
// Connectors themselves (they receive a resolved credential as a plain
// sync() parameter, supplied by connector-connections); never imported by
// Core, Apps, or Settings. See docs/phases/PHASE_5_PLAN.md §5.
export { deleteConnectorCredential, resolveConnectorCredential, storeConnectorCredential } from "./secret.service";
