import {
  ConnectorAuthError,
  type ConnectorConnectConfig,
  type ConnectorConnectResult,
  type ConnectorContract,
  type ConnectorSyncParams,
  type ConnectorSyncResult,
  type NormalizedProduct,
} from "../connector-contract.types";

// Real adapter for Shopify's Admin REST API. Auth is a per-store Admin API
// access token (config: { shopDomain, accessToken }) -- the simplest
// credential shape that needs no OAuth-callback infrastructure this phase
// doesn't otherwise have (see docs/phases/PHASE_5_PLAN.md's Design
// Decisions section). Every method is pure network I/O against Shopify's
// own API -- no Firestore, no Core, no Platform import, same isolation
// rule as every other Connector.
const API_VERSION = "2024-01";

function baseUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${API_VERSION}`;
}

function assertConfig(config: ConnectorConnectConfig): { shopDomain: string; accessToken: string } {
  const shopDomain = config.shopDomain;
  const accessToken = config.accessToken;
  if (typeof shopDomain !== "string" || shopDomain.trim() === "") {
    throw new Error("Shopify connector requires a non-empty shopDomain.");
  }
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new Error("Shopify connector requires a non-empty accessToken.");
  }
  return { shopDomain, accessToken };
}

export const shopifyConnector: ConnectorContract = {
  id: "shopify",
  displayName: "Shopify",

  async connect(config: ConnectorConnectConfig): Promise<ConnectorConnectResult> {
    const { shopDomain, accessToken } = assertConfig(config);

    const response = await fetch(`${baseUrl(shopDomain)}/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    }).catch((error: unknown) => {
      throw new ConnectorAuthError("shopify", error instanceof Error ? error.message : "network error");
    });

    if (!response.ok) {
      throw new ConnectorAuthError("shopify", `${response.status} ${response.statusText}`);
    }

    return { status: "connected", credential: accessToken, safeConfig: { shopDomain } };
  },

  async disconnect() {
    // Nothing server-side to tear down: Phase 5 uses on-demand sync, not a
    // registered webhook subscription -- see PHASE_5_PLAN.md §8.
  },

  async sync(params?: ConnectorSyncParams): Promise<ConnectorSyncResult> {
    const shopDomain = params?.config?.shopDomain;
    const accessToken = params?.credential;
    if (typeof shopDomain !== "string" || !accessToken) {
      throw new Error("Shopify sync requires a resolved credential and shopDomain config.");
    }
    const headers = { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" };

    const productsResponse = await fetch(`${baseUrl(shopDomain)}/products.json?limit=50`, { headers });
    if (!productsResponse.ok) {
      throw new ConnectorAuthError("shopify", `product sync failed: ${productsResponse.status}`);
    }
    const productsBody = (await productsResponse.json()) as {
      products: { id: number; title: string; variants: { id: number; title: string; sku?: string; price: string; inventory_quantity?: number }[] }[];
    };

    const products: NormalizedProduct[] = productsBody.products.flatMap((product) =>
      product.variants.map((variant) => ({
        externalId: String(variant.id),
        name: variant.title === "Default Title" ? product.title : `${product.title} - ${variant.title}`,
        sku: variant.sku || undefined,
        price: Number.parseFloat(variant.price),
        quantity: variant.inventory_quantity,
      })),
    );

    const pushedOrders: { orderId: string; externalOrderId: string }[] = [];
    const failedOrderIds: string[] = [];
    for (const order of params?.outboundOrders ?? []) {
      const response = await fetch(`${baseUrl(shopDomain)}/orders.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          order: {
            line_items: order.lines.map((line) => ({
              title: line.name,
              price: line.unitPrice.toFixed(2),
              quantity: line.quantity,
            })),
            financial_status: "paid",
            tags: "virtuo-os",
          },
        }),
      }).catch(() => null);

      if (!response || !response.ok) {
        failedOrderIds.push(order.orderId);
        continue;
      }
      const body = (await response.json()) as { order: { id: number } };
      pushedOrders.push({ orderId: order.orderId, externalOrderId: String(body.order.id) });
    }

    return { syncedAt: new Date().toISOString(), products, pushedOrders, failedOrderIds };
  },

  async onWebhook(payload: unknown) {
    // Normalizes a Shopify webhook payload's shape enough to prove the
    // contract end-to-end; Phase 5 doesn't call Shopify's own
    // webhook-subscription-creation API, so nothing calls this in
    // production yet unless a subscription is configured manually outside
    // the app -- see PHASE_5_PLAN.md §8's documented boundary.
    void payload;
    return { receivedAt: new Date().toISOString() };
  },
};
