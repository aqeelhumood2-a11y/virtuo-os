export { getConnectorConnection, listCompanyConnectors } from "./connector-connection.repository";
export {
  ConnectorNotEntitledError,
  ConnectorNotRegisteredError,
  connectConnector,
  disconnectConnector,
  handleWebhook,
} from "./connector-connection.service";
export type {
  ConnectorCapability,
  ConnectorConnection,
  ConnectorConnectionAuditAction,
  ConnectorConnectionStatus,
} from "./connector-connection.types";

// Re-exported so Settings (and any future consumer) never needs to import
// connectors/ directly -- platform/connector-connections is the only
// module permitted to. See docs/phases/PHASE_2_PLAN.md's Dependency Rules.
export { getRegisteredConnectors } from "@/connectors";
export type { ConnectorContract } from "@/connectors";
