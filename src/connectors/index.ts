export { getConnectorContract, getRegisteredConnectors, registerConnector } from "./registry";
export { ConnectorAuthError } from "./connector-contract.types";
export type {
  ConnectorConnectConfig,
  ConnectorConnectResult,
  ConnectorContract,
  ConnectorSyncParams,
  ConnectorSyncResult,
  ConnectorWebhookResult,
  NormalizedOutboundOrder,
  NormalizedOutboundOrderLine,
  NormalizedProduct,
} from "./connector-contract.types";
