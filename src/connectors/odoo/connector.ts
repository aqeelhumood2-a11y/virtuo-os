import {
  ConnectorAuthError,
  type ConnectorConnectConfig,
  type ConnectorConnectResult,
  type ConnectorContract,
  type ConnectorSyncParams,
  type ConnectorSyncResult,
  type NormalizedProduct,
} from "../connector-contract.types";

// Real adapter for Odoo, built against its standard JSON-RPC external API
// (/jsonrpc, common.authenticate + object.execute_kw) -- the only one of
// the roadmap's three named ERPs (Odoo/SAP/Oracle) with a single,
// self-hostable, publicly documented API that doesn't require a
// per-customer enterprise integration contract to reason about. SAP
// (OData/RFC, tenant- and module-specific) and Oracle (REST, tenant- and
// module-specific) are deliberately not built this phase: the roadmap
// itself defers their priority ("implemented in priority order once you
// tell us which businesses need which first" -- docs/ROADMAP.md Phase
// 5.3), and guessing a specific SAP/Oracle module's API shape without that
// input would not be a real integration. See docs/phases/PHASE_5_PLAN.md
// §4 for the full reasoning. Pure network I/O only, same isolation rule as
// every other Connector.
type JsonRpcConfig = { url: string; db: string; username: string; apiKey: string };

function assertConfig(config: ConnectorConnectConfig): JsonRpcConfig {
  const { url, db, username, apiKey } = config;
  if (typeof url !== "string" || url.trim() === "") throw new Error("Odoo connector requires a non-empty url.");
  if (typeof db !== "string" || db.trim() === "") throw new Error("Odoo connector requires a non-empty db.");
  if (typeof username !== "string" || username.trim() === "") throw new Error("Odoo connector requires a non-empty username.");
  if (typeof apiKey !== "string" || apiKey.trim() === "") throw new Error("Odoo connector requires a non-empty apiKey.");
  return { url, db, username, apiKey };
}

async function jsonRpcCall(url: string, service: string, method: string, args: unknown[]): Promise<unknown> {
  const response = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: 0 }),
  });
  if (!response.ok) throw new ConnectorAuthError("odoo", `${response.status} ${response.statusText}`);
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new ConnectorAuthError("odoo", body.error.message);
  return body.result;
}

async function authenticate(config: JsonRpcConfig): Promise<number> {
  const result = await jsonRpcCall(config.url, "common", "authenticate", [config.db, config.username, config.apiKey, {}]);
  if (typeof result !== "number") throw new ConnectorAuthError("odoo", "authentication failed");
  return result;
}

async function executeKw(config: JsonRpcConfig, uid: number, model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<unknown> {
  return jsonRpcCall(config.url, "object", "execute_kw", [config.db, uid, config.apiKey, model, method, args, kwargs]);
}

export const odooConnector: ConnectorContract = {
  id: "odoo",
  displayName: "Odoo",

  async connect(config: ConnectorConnectConfig): Promise<ConnectorConnectResult> {
    const parsed = assertConfig(config);
    await authenticate(parsed);
    return {
      status: "connected",
      credential: parsed.apiKey,
      safeConfig: { url: parsed.url, db: parsed.db, username: parsed.username },
    };
  },

  async disconnect() {
    // No server-side subscription to tear down -- on-demand sync only.
  },

  async sync(params?: ConnectorSyncParams): Promise<ConnectorSyncResult> {
    const url = params?.config?.url;
    const db = params?.config?.db;
    const username = params?.config?.username;
    const apiKey = params?.credential;
    if (typeof url !== "string" || typeof db !== "string" || typeof username !== "string" || !apiKey) {
      throw new Error("Odoo sync requires a resolved credential and url/db/username config.");
    }
    const config: JsonRpcConfig = { url, db, username, apiKey };
    const uid = await authenticate(config);

    const productRows = (await executeKw(config, uid, "product.product", "search_read", [[]], {
      fields: ["name", "default_code", "list_price", "qty_available"],
      limit: 100,
    })) as { id: number; name: string; default_code?: string; list_price: number; qty_available: number }[];

    const products: NormalizedProduct[] = productRows.map((row) => ({
      externalId: String(row.id),
      name: row.name,
      sku: row.default_code || undefined,
      price: row.list_price,
      quantity: row.qty_available,
    }));

    const pushedOrders: { orderId: string; externalOrderId: string }[] = [];
    const failedOrderIds: string[] = [];
    for (const order of params?.outboundOrders ?? []) {
      try {
        const orderLines: unknown[] = [];
        for (const line of order.lines) {
          if (!line.sku) throw new Error(`line "${line.name}" has no sku to resolve against Odoo's catalog`);
          const matches = (await executeKw(config, uid, "product.product", "search_read", [[["default_code", "=", line.sku]]], {
            fields: ["id"],
            limit: 1,
          })) as { id: number }[];
          if (matches.length === 0) throw new Error(`no Odoo product found for sku "${line.sku}"`);
          orderLines.push([0, 0, { product_id: matches[0].id, product_uom_qty: line.quantity, price_unit: line.unitPrice }]);
        }

        // partner_id: 1 is Odoo's own seeded "Public user" partner -- Phase
        // 5 has no customer/partner mapping (Core has no customer model at
        // all, same limitation Loyalty's members are the only counterpart
        // to), so every pushed order attaches to it. A real partner
        // mapping is Backlog, not this phase's job.
        const saleOrderId = (await executeKw(config, uid, "sale.order", "create", [
          { partner_id: 1, order_line: orderLines },
        ])) as number;
        pushedOrders.push({ orderId: order.orderId, externalOrderId: String(saleOrderId) });
      } catch {
        failedOrderIds.push(order.orderId);
      }
    }

    return { syncedAt: new Date().toISOString(), products, pushedOrders, failedOrderIds };
  },

  async onWebhook(payload: unknown) {
    void payload;
    return { receivedAt: new Date().toISOString() };
  },
};
