import type { ConnectorContract } from "../connector-contract.types";

// The one stub connector for Phase 2 -- proves the ConnectorContract shape
// end-to-end with zero real external system. Every method is pure: no
// Firestore, no Core, no Platform import, and no side effect beyond
// computing and returning a plain result (see connector-contract.types.ts).
export const customApiConnector: ConnectorContract = {
  id: "custom-api",
  displayName: "Custom API",

  async connect() {
    return { status: "connected" };
  },

  async disconnect() {},

  async sync() {
    // The stub has no external system to reach -- it never discovers
    // products and never pushes any of the outboundOrders it's handed.
    return { syncedAt: new Date().toISOString() };
  },

  async onWebhook() {
    return { receivedAt: new Date().toISOString() };
  },
};
