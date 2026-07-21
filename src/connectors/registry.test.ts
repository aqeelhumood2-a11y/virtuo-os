import { describe, expect, it } from "vitest";

import { getConnectorContract, getRegisteredConnectors, registerConnector } from "./registry";
import type { ConnectorContract } from "./connector-contract.types";

describe("connectors registry", () => {
  it("registers the custom-api stub at module load", () => {
    expect(getConnectorContract("custom-api")?.displayName).toBe("Custom API");
    expect(getRegisteredConnectors().some((c) => c.id === "custom-api")).toBe(true);
  });

  it("registers the Phase 5 real connectors (shopify, square, odoo) at module load", () => {
    expect(getConnectorContract("shopify")?.displayName).toBe("Shopify");
    expect(getConnectorContract("square")?.displayName).toBe("Square");
    expect(getConnectorContract("odoo")?.displayName).toBe("Odoo");
  });

  it("returns null for an unregistered connector id", () => {
    expect(getConnectorContract("does-not-exist")).toBeNull();
  });

  it("registerConnector adds a new connector, discoverable by id and in the full list", () => {
    const fake: ConnectorContract = {
      id: "fake-connector",
      displayName: "Fake",
      connect: async () => ({ status: "connected" }),
      disconnect: async () => {},
      sync: async () => ({ syncedAt: new Date().toISOString() }),
      onWebhook: async () => ({ receivedAt: new Date().toISOString() }),
    };

    registerConnector(fake);

    expect(getConnectorContract("fake-connector")).toBe(fake);
    expect(getRegisteredConnectors()).toContain(fake);
  });
});
