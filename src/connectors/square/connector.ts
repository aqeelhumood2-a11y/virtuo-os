import {
  ConnectorAuthError,
  type ConnectorConnectConfig,
  type ConnectorConnectResult,
  type ConnectorContract,
  type ConnectorSyncParams,
  type ConnectorSyncResult,
  type NormalizedProduct,
} from "../connector-contract.types";

// Real adapter for Square's REST API. Auth is a personal/production access
// token scoped to one location (config: { accessToken, locationId }) --
// same access-token-only rationale as Shopify's connector, see
// docs/phases/PHASE_5_PLAN.md. Pure network I/O only, same isolation rule
// as every other Connector.
const API_BASE = "https://connect.squareup.com/v2";

function assertConfig(config: ConnectorConnectConfig): { accessToken: string; locationId: string } {
  const accessToken = config.accessToken;
  const locationId = config.locationId;
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new Error("Square connector requires a non-empty accessToken.");
  }
  if (typeof locationId !== "string" || locationId.trim() === "") {
    throw new Error("Square connector requires a non-empty locationId.");
  }
  return { accessToken, locationId };
}

export const squareConnector: ConnectorContract = {
  id: "square",
  displayName: "Square",

  async connect(config: ConnectorConnectConfig): Promise<ConnectorConnectResult> {
    const { accessToken, locationId } = assertConfig(config);

    const response = await fetch(`${API_BASE}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch((error: unknown) => {
      throw new ConnectorAuthError("square", error instanceof Error ? error.message : "network error");
    });

    if (!response.ok) {
      throw new ConnectorAuthError("square", `${response.status} ${response.statusText}`);
    }

    return { status: "connected", credential: accessToken, safeConfig: { locationId } };
  },

  async disconnect() {
    // No server-side subscription to tear down -- on-demand sync only.
  },

  async sync(params?: ConnectorSyncParams): Promise<ConnectorSyncResult> {
    const locationId = params?.config?.locationId;
    const accessToken = params?.credential;
    if (typeof locationId !== "string" || !accessToken) {
      throw new Error("Square sync requires a resolved credential and locationId config.");
    }
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    const catalogResponse = await fetch(`${API_BASE}/catalog/list?types=ITEM`, { headers });
    if (!catalogResponse.ok) {
      throw new ConnectorAuthError("square", `product sync failed: ${catalogResponse.status}`);
    }
    const catalogBody = (await catalogResponse.json()) as {
      objects?: {
        id: string;
        item_data: { name: string; variations: { id: string; item_variation_data: { sku?: string; price_money?: { amount: number } } }[] };
      }[];
    };

    const products: NormalizedProduct[] = (catalogBody.objects ?? []).flatMap((object) =>
      object.item_data.variations.map((variation) => ({
        externalId: variation.id,
        name: object.item_data.name,
        sku: variation.item_variation_data.sku || undefined,
        // Square money amounts are integer minor units (cents).
        price: variation.item_variation_data.price_money ? variation.item_variation_data.price_money.amount / 100 : undefined,
      })),
    );

    const pushedOrders: { orderId: string; externalOrderId: string }[] = [];
    const failedOrderIds: string[] = [];
    for (const order of params?.outboundOrders ?? []) {
      const response = await fetch(`${API_BASE}/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          idempotency_key: order.orderId,
          order: {
            location_id: locationId,
            line_items: order.lines.map((line) => ({
              name: line.name,
              quantity: String(line.quantity),
              base_price_money: { amount: Math.round(line.unitPrice * 100), currency: "USD" },
            })),
          },
        }),
      }).catch(() => null);

      if (!response || !response.ok) {
        failedOrderIds.push(order.orderId);
        continue;
      }
      const body = (await response.json()) as { order: { id: string } };
      pushedOrders.push({ orderId: order.orderId, externalOrderId: body.order.id });
    }

    return { syncedAt: new Date().toISOString(), products, pushedOrders, failedOrderIds };
  },

  async onWebhook(payload: unknown) {
    void payload;
    return { receivedAt: new Date().toISOString() };
  },
};
