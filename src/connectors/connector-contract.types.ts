// A Connector is a pure adapter: receive input, validate, normalize,
// return output. It must never import Core, Platform, App Registry, or any
// Firestore repository -- all state, persistence, and orchestration
// (capability checks, audit logging, notifications) live in
// platform/connector-connections, the only module permitted to import
// this one. See docs/phases/PHASE_2_PLAN.md §2/§4/§5.
export type ConnectorConnectConfig = Record<string, unknown>;

export type ConnectorConnectResult = {
  status: "connected";
  // An opaque pointer to a secret held elsewhere (e.g. a Secret Manager
  // name/version) -- never the credential itself. See docs/DATABASE.md §5.
  credentialRef?: string;
};

export type ConnectorSyncResult = {
  syncedAt: string; // ISO timestamp -- plain data, never a Firestore Timestamp
};

export type ConnectorWebhookResult = {
  receivedAt: string;
};

export interface ConnectorContract {
  readonly id: string;
  readonly displayName: string;
  connect(config: ConnectorConnectConfig): Promise<ConnectorConnectResult>;
  disconnect(): Promise<void>;
  sync(): Promise<ConnectorSyncResult>;
  onWebhook(payload: unknown): Promise<ConnectorWebhookResult>;
}
