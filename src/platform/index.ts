// Platform: commercial/tenant-activation business logic only -- license
// entitlement, installed-App state + rules, connected-Connector state +
// rules. No Server Actions, no forms, no UI. See docs/phases/PHASE_2_PLAN.md.
export { getCompanyLicense, isAppEntitled, isConnectorEntitled } from "./licenses/license.repository";
export type { License, LicenseCapability } from "./licenses/license.types";

export { isAppInstalled, listInstalledApps } from "./app-installs/app-install.repository";
export {
  AppNotEntitledError,
  AppNotRegisteredError,
  forceToggleApp,
  installApp,
  uninstallApp,
} from "./app-installs/app-install.service";
export type { AppInstallAuditAction, AppInstallCapability, InstalledApp } from "./app-installs/app-install.types";

export { getConnectorConnection, listCompanyConnectors } from "./connector-connections/connector-connection.repository";
export {
  ConnectorNotConnectedError,
  ConnectorNotEntitledError,
  ConnectorNotRegisteredError,
  connectConnector,
  disconnectConnector,
  handleWebhook,
  syncConnector,
} from "./connector-connections/connector-connection.service";
export type {
  ConnectorCapability,
  ConnectorConnection,
  ConnectorConnectionAuditAction,
  ConnectorConnectionStatus,
  ConnectorSyncSummary,
} from "./connector-connections/connector-connection.types";
export { listProductMappings } from "./connector-connections/product-mapping.repository";
export type { ProductMapping } from "./connector-connections/product-mapping.repository";
export { ConnectorAuthError, getRegisteredConnectors } from "./connector-connections";
export type { ConnectorContract } from "./connector-connections";

export { hasPlatformCapability, requirePlatformCapability } from "./shared/require-platform-capability";
export type { PlatformCapability } from "./shared/require-platform-capability";
