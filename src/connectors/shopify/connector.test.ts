import { beforeEach, describe, expect, it, vi } from "vitest";

import { shopifyConnector } from "./connector";
import { ConnectorAuthError } from "../connector-contract.types";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("shopifyConnector.connect", () => {
  it("rejects config missing shopDomain/accessToken", async () => {
    await expect(shopifyConnector.connect({})).rejects.toThrow(/shopDomain/);
    await expect(shopifyConnector.connect({ shopDomain: "shop.myshopify.com" })).rejects.toThrow(/accessToken/);
  });

  it("pings shop.json and returns credential + safeConfig on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const result = await shopifyConnector.connect({ shopDomain: "shop.myshopify.com", accessToken: "shpat_abc" });

    expect(result).toEqual({
      status: "connected",
      credential: "shpat_abc",
      safeConfig: { shopDomain: "shop.myshopify.com" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shop.myshopify.com/admin/api/2024-01/shop.json",
      expect.objectContaining({ headers: { "X-Shopify-Access-Token": "shpat_abc" } }),
    );
  });

  it("throws ConnectorAuthError when Shopify rejects the token", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(
      shopifyConnector.connect({ shopDomain: "shop.myshopify.com", accessToken: "bad" }),
    ).rejects.toThrow(ConnectorAuthError);
  });

  it("throws ConnectorAuthError on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      shopifyConnector.connect({ shopDomain: "shop.myshopify.com", accessToken: "tok" }),
    ).rejects.toThrow(ConnectorAuthError);
  });
});

describe("shopifyConnector.sync", () => {
  const params = { credential: "shpat_abc", config: { shopDomain: "shop.myshopify.com" }, outboundOrders: [] };

  it("normalizes products from products.json", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [
          {
            id: 1,
            title: "Widget",
            variants: [{ id: 11, title: "Default Title", sku: "W-1", price: "9.99", inventory_quantity: 5 }],
          },
          {
            id: 2,
            title: "Gadget",
            variants: [
              { id: 21, title: "Small", sku: "G-S", price: "4.50", inventory_quantity: 2 },
              { id: 22, title: "Large", sku: "G-L", price: "6.50", inventory_quantity: 1 },
            ],
          },
        ],
      }),
    });

    const result = await shopifyConnector.sync(params);

    expect(result.products).toEqual([
      { externalId: "11", name: "Widget", sku: "W-1", price: 9.99, quantity: 5 },
      { externalId: "21", name: "Gadget - Small", sku: "G-S", price: 4.5, quantity: 2 },
      { externalId: "22", name: "Gadget - Large", sku: "G-L", price: 6.5, quantity: 1 },
    ]);
    expect(result.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("pushes outbound orders as ad hoc line items and reports the external order id", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ products: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { id: 999 } }) });

    const result = await shopifyConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ name: "Widget", quantity: 2, unitPrice: 9.99 }], total: 19.98 }],
    });

    expect(result.pushedOrders).toEqual([{ orderId: "order-1", externalOrderId: "999" }]);
    expect(result.failedOrderIds).toEqual([]);
    const [, postCall] = fetchMock.mock.calls[1];
    expect(postCall).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          order: {
            line_items: [{ title: "Widget", price: "9.99", quantity: 2 }],
            financial_status: "paid",
            tags: "virtuo-os",
          },
        }),
      }),
    );
  });

  it("records a failed push without aborting the rest of the sync", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ products: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 422 });

    const result = await shopifyConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ name: "Widget", quantity: 1, unitPrice: 9.99 }], total: 9.99 }],
    });

    expect(result.pushedOrders).toEqual([]);
    expect(result.failedOrderIds).toEqual(["order-1"]);
  });

  it("throws when called without a resolved credential", async () => {
    await expect(shopifyConnector.sync({ config: { shopDomain: "shop.myshopify.com" }, outboundOrders: [] })).rejects.toThrow();
  });
});

describe("shopifyConnector.onWebhook", () => {
  it("returns a plain ISO timestamp regardless of payload", async () => {
    const result = await shopifyConnector.onWebhook({ anything: "goes" });
    expect(result.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
