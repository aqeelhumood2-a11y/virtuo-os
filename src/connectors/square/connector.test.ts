import { beforeEach, describe, expect, it, vi } from "vitest";

import { squareConnector } from "./connector";
import { ConnectorAuthError } from "../connector-contract.types";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("squareConnector.connect", () => {
  it("rejects config missing accessToken/locationId", async () => {
    await expect(squareConnector.connect({})).rejects.toThrow(/accessToken/);
    await expect(squareConnector.connect({ accessToken: "tok" })).rejects.toThrow(/locationId/);
  });

  it("pings the location and returns credential + safeConfig on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const result = await squareConnector.connect({ accessToken: "sq0atp-abc", locationId: "L1" });

    expect(result).toEqual({ status: "connected", credential: "sq0atp-abc", safeConfig: { locationId: "L1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connect.squareup.com/v2/locations/L1",
      expect.objectContaining({ headers: { Authorization: "Bearer sq0atp-abc" } }),
    );
  });

  it("throws ConnectorAuthError when Square rejects the token", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(squareConnector.connect({ accessToken: "bad", locationId: "L1" })).rejects.toThrow(ConnectorAuthError);
  });
});

describe("squareConnector.sync", () => {
  const params = { credential: "sq0atp-abc", config: { locationId: "L1" }, outboundOrders: [] };

  it("normalizes catalog items into products, converting minor-unit price to major", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          {
            id: "item-1",
            item_data: {
              name: "Widget",
              variations: [{ id: "var-1", item_variation_data: { sku: "W-1", price_money: { amount: 999 } } }],
            },
          },
        ],
      }),
    });

    const result = await squareConnector.sync(params);

    expect(result.products).toEqual([{ externalId: "var-1", name: "Widget", sku: "W-1", price: 9.99 }]);
  });

  it("pushes outbound orders with an idempotency_key and reports the external order id", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ objects: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { id: "sq-order-1" } }) });

    const result = await squareConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ name: "Widget", quantity: 2, unitPrice: 9.99 }], total: 19.98 }],
    });

    expect(result.pushedOrders).toEqual([{ orderId: "order-1", externalOrderId: "sq-order-1" }]);
    const [, postCall] = fetchMock.mock.calls[1];
    const body = JSON.parse((postCall as { body: string }).body);
    expect(body.idempotency_key).toBe("order-1");
    expect(body.order.line_items).toEqual([{ name: "Widget", quantity: "2", base_price_money: { amount: 999, currency: "USD" } }]);
  });

  it("records a failed push without aborting the rest of the sync", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ objects: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 400 });

    const result = await squareConnector.sync({
      ...params,
      outboundOrders: [{ orderId: "order-1", lines: [{ name: "Widget", quantity: 1, unitPrice: 9.99 }], total: 9.99 }],
    });

    expect(result.pushedOrders).toEqual([]);
    expect(result.failedOrderIds).toEqual(["order-1"]);
  });
});
