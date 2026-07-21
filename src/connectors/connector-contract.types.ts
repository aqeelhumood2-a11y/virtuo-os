// A Connector is a pure adapter: receive input, validate, normalize,
// return output. It must never import Core, Platform, App Registry, or any
// Firestore repository -- all state, persistence, and orchestration
// (capability checks, audit logging, notifications, credential storage)
// live in platform/connector-connections, the only module permitted to
// import this one. See docs/phases/PHASE_2_PLAN.md §2/§4/§5 and
// docs/phases/PHASE_5_PLAN.md for the real-connector extensions below.
export type ConnectorConnectConfig = Record<string, unknown>;

export type ConnectorConnectResult = {
  status: "connected";
  // A plaintext secret (API key/access token) the connector needed to
  // validate the connection. Platform moves this into Secret Manager and
  // never persists it to Firestore -- see platform/secrets and
  // docs/DATABASE.md §5. Absent for connectors with nothing secret to hold
  // (e.g. the Phase 2 custom-api stub).
  credential?: string;
  // The non-secret subset of the submitted config, safe for Platform to
  // persist directly on the connection document (e.g. a shop domain or
  // location ID) -- only the connector itself knows which of its own
  // config fields are secret and which aren't.
  safeConfig?: Record<string, unknown>;
};

// One product/item as reported by an external system, normalized to a
// shape Platform can reconcile against Core's Inventory Engine without
// knowing anything about Shopify/Square/Odoo's own schemas.
export type NormalizedProduct = {
  externalId: string;
  name: string;
  sku?: string;
  price?: number; // major currency unit
  quantity?: number; // externally reported stock level -- informational only, see PHASE_5_PLAN.md §6
};

// One Core order, normalized for a connector to push outward. sku is
// included so a connector that requires a real product reference
// server-side (e.g. Odoo) can attempt to resolve one; connectors that
// accept ad hoc line items (Shopify, Square) may ignore it.
export type NormalizedOutboundOrderLine = {
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type NormalizedOutboundOrder = {
  orderId: string; // Core's own order ID
  lines: NormalizedOutboundOrderLine[];
  total: number;
};

export type ConnectorSyncParams = {
  // The plaintext secret Platform resolved from Secret Manager for this
  // connection, if any.
  credential?: string;
  // The safeConfig persisted at connect time.
  config?: Record<string, unknown>;
  // A bounded batch of completed Core orders not yet pushed to this
  // connector (Platform selects and bounds this list -- see
  // docs/phases/PHASE_5_PLAN.md §7).
  outboundOrders: NormalizedOutboundOrder[];
};

export type ConnectorSyncResult = {
  syncedAt: string; // ISO timestamp -- plain data, never a Firestore Timestamp
  // Inbound: products/items discovered on the external system this run.
  products?: NormalizedProduct[];
  // Outbound: orders from outboundOrders that were successfully created
  // remotely this run, paired with the external system's own order id.
  pushedOrders?: { orderId: string; externalOrderId: string }[];
  // Outbound: orders from outboundOrders the connector attempted but could
  // not push (e.g. no matching product reference) -- Platform does not
  // record these as pushed, so a later sync retries them.
  failedOrderIds?: string[];
};

export type ConnectorWebhookResult = {
  receivedAt: string;
};

export interface ConnectorContract {
  readonly id: string;
  readonly displayName: string;
  connect(config: ConnectorConnectConfig): Promise<ConnectorConnectResult>;
  disconnect(): Promise<void>;
  // params is optional at the call site (existing stubs/tests call sync()
  // with nothing) -- a real connector reads params?.outboundOrders ?? [].
  sync(params?: ConnectorSyncParams): Promise<ConnectorSyncResult>;
  onWebhook(payload: unknown): Promise<ConnectorWebhookResult>;
}

// Thrown by a connector's connect() when the external system rejects the
// submitted credential/config -- a real, expected outcome for real
// connectors (unlike the Phase 2 stub, which never fails). Platform maps
// this to a user-facing message rather than a generic 500.
export class ConnectorAuthError extends Error {
  constructor(connectorId: string, reason?: string) {
    super(`"${connectorId}" rejected the provided credentials${reason ? `: ${reason}` : "."}`);
    this.name = "ConnectorAuthError";
  }
}
