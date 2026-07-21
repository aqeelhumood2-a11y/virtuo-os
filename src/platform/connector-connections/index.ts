export { getConnectorConnection, listCompanyConnectors } from "./connector-connection.repository";
export {
  ConnectorNotConnectedError,
  ConnectorNotEntitledError,
  ConnectorNotRegisteredError,
  connectConnector,
  disconnectConnector,
  handleWebhook,
  syncConnector,
} from "./connector-connection.service";
export type {
  ConnectorCapability,
  ConnectorConnection,
  ConnectorConnectionAuditAction,
  ConnectorConnectionStatus,
  ConnectorSyncSummary,
} from "./connector-connection.types";
export { listProductMappings } from "./product-mapping.repository";
export type { ProductMapping } from "./product-mapping.repository";

// Re-exported so Settings (and any future consumer) never needs to import
// connectors/ directly -- platform/connector-connections is the only
// module permitted to. See docs/phases/PHASE_2_PLAN.md's Dependency Rules.
export { ConnectorAuthError, getRegisteredConnectors } from "@/connectors";
export type { ConnectorContract } from "@/connectors";
