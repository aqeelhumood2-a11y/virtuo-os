// Platform's own capability, never added to core/roles-permissions -- see
// docs/phases/PHASE_2_PLAN.md §8.
export type ConnectorCapability = "connectors.view" | "connectors.manage";

// Colocated with the module that produces these actions -- see
// app-installs/app-install.types.ts's AppInstallAuditAction for the same
// reasoning. "connector.synced" added in Phase 5 for syncConnector().
export type ConnectorConnectionAuditAction = "connector.connected" | "connector.disconnected" | "connector.synced";

export type ConnectorConnectionStatus = "connected" | "disconnected" | "error";

// companies/{companyId}/connectors/{connectorId} -- connection state only.
// Credentials are never stored here, only an opaque reference -- see
// docs/DATABASE.md §5.
export type ConnectorConnection = {
  connectorId: string;
  status: ConnectorConnectionStatus;
  lastSyncAt?: string;
  credentialRef?: string;
  config?: Record<string, unknown>;
};

// The result of one syncConnector() run -- a plain summary for the
// Settings UI, not a domain type persisted anywhere itself (the durable
// records are the productMappings/outboundOrderMappings docs and the
// connector.synced audit entry).
export type ConnectorSyncSummary = {
  syncedAt: string;
  productsSynced: number;
  ordersPushed: number;
  ordersFailed: number;
};
