import { beforeEach, describe, expect, it, vi } from "vitest";

import { odooConnector } from "./connector";
import { ConnectorAuthError } from "../connector-contract.types";

const fetchMock = vi.fn();

function jsonRpcResult(result: unknown) {
  return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 0, result }) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("odooConnector.connect", () => {
  it("rejects config missing url/db/username/apiKey", async () => {
    await expect(odooConnector.connect({})).rejects.toThrow(/url/);
    await expect(odooConnector.connect({ url: "https://odoo.example.com" })).rejects.toThrow(/db/);
  });

  it("authenticates via JSON-RPC and returns credential + safeConfig on success", async () => {
    fetchMock.mockResolvedValue(jsonRpcResult(7));

    const result = await odooConnector.connect({ url: "https://odoo.example.com", db: "mydb", username: "admin", apiKey: "key123" });

    expect(result).toEqual({
      status: "connected",
      credential: "key123",
      safeConfig: { url: "https://odoo.example.com", db: "mydb", username: "admin" },
    });
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://odoo.example.com/jsonrpc");
    const body = JSON.parse((options as { body: string }).body);
    expect(body.params).toEqual({ service: "common", method: "authenticate", args: ["mydb", "admin", "key123", {}] });
  });

  it("throws ConnectorAuthError when authenticate returns false", async () => {
    fetchMock.mockResolvedValue(jsonRpcResult(false));

    await expect(
      odooConnector.connect({ url: "https://odoo.example.com", db: "mydb", username: "admin", apiKey: "bad" }),
    ).rejects.toThrow(ConnectorAuthError);
  });

  it("throws ConnectorAuthError on a JSON-RPC error response", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: { message: "Access Denied" } }) });

    await expect(
      odooConnector.connect({ url: "https://odoo.example.com", db: "mydb", username: "admin", apiKey: "bad" }),
    ).rejects.toThrow(ConnectorAuthError);
  });
});

describe("odooConnector.sync", () => {
  const params = {
    credential: "key123",
    config: { url: "https://odoo.example.com", db: "mydb", username: "admin" },
    outboundOrders: [],
  };

  it("normalizes product.product rows into products", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRpcResult(7)) // authenticate
      .mockResolvedValueOnce(
        jsonRpcResult([{ id: 42, name: "Widget", default_code: "W-1", list_price: 9.99, qty_available: 5 }]),
      );

    const result = await odooConnector.sync(params);

    expect(result.products).toEqual([{ externalId: "42", name: "Widget", sku: "W-1", price: 9.99, quantity: 5 }]);
  });

  it("resolves a product by sku and pushes a sale order", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRpcResult(7)) // authenticate
      .mockResolvedValueOnce(jsonRpcResult([])) // product search_read (inbound)
      .mockResolvedValueOnce(jsonRpcResult([{ id: 42 }])) // sku lookup for outbound line
      .mockResolvedValueOnce(jsonRpcResult(555)); // sale.order create

    const result = await odooConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ sku: "W-1", name: "Widget", quantity: 2, unitPrice: 9.99 }], total: 19.98 }],
    });

    expect(result.pushedOrders).toEqual([{ orderId: "order-1", externalOrderId: "555" }]);
    expect(result.failedOrderIds).toEqual([]);
  });

  it("skips an order whose line has no matching Odoo product, without aborting the run", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRpcResult(7)) // authenticate
      .mockResolvedValueOnce(jsonRpcResult([])) // product search_read (inbound)
      .mockResolvedValueOnce(jsonRpcResult([])); // sku lookup finds nothing

    const result = await odooConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ sku: "UNKNOWN", name: "Mystery", quantity: 1, unitPrice: 1 }], total: 1 }],
    });

    expect(result.pushedOrders).toEqual([]);
    expect(result.failedOrderIds).toEqual(["order-1"]);
  });

  it("skips an order line with no sku at all", async () => {
    fetchMock.mockResolvedValueOnce(jsonRpcResult(7)).mockResolvedValueOnce(jsonRpcResult([]));

    const result = await odooConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ name: "No SKU", quantity: 1, unitPrice: 1 }], total: 1 }],
    });

    expect(result.failedOrderIds).toEqual(["order-1"]);
  });
});
