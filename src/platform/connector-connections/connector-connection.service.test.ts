import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectorConnectResult, ConnectorSyncResult } from "@/connectors";

const requirePlatformCapabilityMock = vi.fn();
const getConnectorContractMock = vi.fn();
const isConnectorEntitledMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

const storeConnectorCredentialMock = vi.fn();
const resolveConnectorCredentialMock = vi.fn();
const deleteConnectorCredentialMock = vi.fn();

const getConnectorConnectionMock = vi.fn();
const getOutboundOrderMappingMock = vi.fn();
const reserveOutboundOrderMock = vi.fn();
const finalizePushedOrderMock = vi.fn();
const releaseReservationMock = vi.fn();
const getProductMappingMock = vi.fn();
const setProductMappingMock = vi.fn();

const listBranchesMock = vi.fn();
const listOrdersForBranchMock = vi.fn();
const listOrderLinesMock = vi.fn();
const createItemMock = vi.fn();
const getItemMock = vi.fn();
const updateItemMock = vi.fn();

const docGetMock = vi.fn();
const docSetMock = vi.fn();

vi.mock("../shared/require-platform-capability", () => ({
  requirePlatformCapability: (...args: unknown[]) => requirePlatformCapabilityMock(...args),
}));

vi.mock("@/connectors", () => ({
  getConnectorContract: (...args: unknown[]) => getConnectorContractMock(...args),
}));

vi.mock("../licenses/license.repository", () => ({
  isConnectorEntitled: (...args: unknown[]) => isConnectorEntitledMock(...args),
}));

vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("../secrets", () => ({
  storeConnectorCredential: (...args: unknown[]) => storeConnectorCredentialMock(...args),
  resolveConnectorCredential: (...args: unknown[]) => resolveConnectorCredentialMock(...args),
  deleteConnectorCredential: (...args: unknown[]) => deleteConnectorCredentialMock(...args),
}));

vi.mock("./connector-connection.repository", () => ({
  connectorConnectionDoc: () => ({ get: () => docGetMock(), set: (...args: unknown[]) => docSetMock(...args) }),
  getConnectorConnection: (...args: unknown[]) => getConnectorConnectionMock(...args),
}));

vi.mock("./order-mapping.repository", () => ({
  getOutboundOrderMapping: (...args: unknown[]) => getOutboundOrderMappingMock(...args),
  reserveOutboundOrder: (...args: unknown[]) => reserveOutboundOrderMock(...args),
  finalizePushedOrder: (...args: unknown[]) => finalizePushedOrderMock(...args),
  releaseReservation: (...args: unknown[]) => releaseReservationMock(...args),
}));

vi.mock("./product-mapping.repository", () => ({
  getProductMapping: (...args: unknown[]) => getProductMappingMock(...args),
  setProductMapping: (...args: unknown[]) => setProductMappingMock(...args),
}));

vi.mock("@/core/companies/branches", () => ({
  listBranches: (...args: unknown[]) => listBranchesMock(...args),
}));

vi.mock("@/core/order-engine", () => ({
  listOrdersForBranch: (...args: unknown[]) => listOrdersForBranchMock(...args),
  listOrderLines: (...args: unknown[]) => listOrderLinesMock(...args),
}));

vi.mock("@/core/inventory-engine", () => ({
  createItem: (...args: unknown[]) => createItemMock(...args),
  getItem: (...args: unknown[]) => getItemMock(...args),
  updateItem: (...args: unknown[]) => updateItemMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown, opts?: unknown) => ref.set(data, opts),
      };
      return fn(fakeTransaction);
    },
  },
}));

const fakeContract = {
  id: "custom-api",
  displayName: "Custom API",
  connect: vi.fn<(...args: unknown[]) => Promise<ConnectorConnectResult>>(async () => ({ status: "connected" })),
  disconnect: vi.fn(async () => {}),
  sync: vi.fn<(...args: unknown[]) => Promise<ConnectorSyncResult>>(async () => ({ syncedAt: "now" })),
  onWebhook: vi.fn(async () => ({ receivedAt: "now" })),
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requirePlatformCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  getConnectorContractMock.mockReturnValue(fakeContract);
  isConnectorEntitledMock.mockResolvedValue(true);
  docGetMock.mockResolvedValue({ exists: false });
  fakeContract.connect.mockResolvedValue({ status: "connected" });
  listBranchesMock.mockResolvedValue([]);
});

describe("connectConnector", () => {
  it("requires connectors.manage, checks the registry and entitlement, calls the pure connector, then persists+audits", async () => {
    const { connectConnector } = await import("./connector-connection.service");
    await connectConnector("company-1", "custom-api", { apiKey: "x" });

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "connectors.manage");
    expect(getConnectorContractMock).toHaveBeenCalledWith("custom-api");
    expect(isConnectorEntitledMock).toHaveBeenCalledWith("company-1", "custom-api");
    expect(fakeContract.connect).toHaveBeenCalledWith({ apiKey: "x" });
    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "connected", credentialRef: null, config: null }),
      { merge: true },
    );
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.connected", targetType: "connectorConnection" }),
    );
  });

  it("moves a returned credential into Secret Manager and persists only the resulting ref + safeConfig", async () => {
    fakeContract.connect.mockResolvedValue({
      status: "connected",
      credential: "shpat_abc",
      safeConfig: { shopDomain: "shop.myshopify.com" },
    });
    storeConnectorCredentialMock.mockResolvedValue("projects/p/secrets/s/versions/1");

    const { connectConnector } = await import("./connector-connection.service");
    await connectConnector("company-1", "shopify", { shopDomain: "shop.myshopify.com", accessToken: "shpat_abc" });

    expect(storeConnectorCredentialMock).toHaveBeenCalledWith("company-1", "shopify", "shpat_abc");
    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "connected",
        credentialRef: "projects/p/secrets/s/versions/1",
        config: { shopDomain: "shop.myshopify.com" },
      }),
      { merge: true },
    );
  });

  it("throws ConnectorNotRegisteredError when the connector isn't in the registry", async () => {
    getConnectorContractMock.mockReturnValue(null);
    const { connectConnector, ConnectorNotRegisteredError } = await import("./connector-connection.service");

    await expect(connectConnector("company-1", "ghost", {})).rejects.toThrow(ConnectorNotRegisteredError);
    expect(docSetMock).not.toHaveBeenCalled();
  });

  it("throws ConnectorNotEntitledError when the plan doesn't include it, never calling the connector", async () => {
    isConnectorEntitledMock.mockResolvedValue(false);
    const { connectConnector, ConnectorNotEntitledError } = await import("./connector-connection.service");

    await expect(connectConnector("company-1", "custom-api", {})).rejects.toThrow(ConnectorNotEntitledError);
    expect(fakeContract.connect).not.toHaveBeenCalled();
    expect(docSetMock).not.toHaveBeenCalled();
  });
});

describe("disconnectConnector", () => {
  it("requires connectors.manage, calls the pure connector's disconnect, and persists+audits", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected" }) });
    const { disconnectConnector } = await import("./connector-connection.service");

    await disconnectConnector("company-1", "custom-api");

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "connectors.manage");
    expect(fakeContract.disconnect).toHaveBeenCalledTimes(1);
    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disconnected", credentialRef: null }),
      { merge: true },
    );
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.disconnected", before: { status: "connected" } }),
    );
  });

  it("never touches Secret Manager for a connection with no stored credential", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected" }) });
    const { disconnectConnector } = await import("./connector-connection.service");

    await disconnectConnector("company-1", "custom-api");

    expect(deleteConnectorCredentialMock).not.toHaveBeenCalled();
  });

  it("deletes the stored credential when the connection had one", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected", credentialRef: "projects/p/secrets/s/versions/1" }) });
    const { disconnectConnector } = await import("./connector-connection.service");

    await disconnectConnector("company-1", "shopify");

    expect(deleteConnectorCredentialMock).toHaveBeenCalledWith("company-1", "shopify");
  });
});

describe("handleWebhook", () => {
  it("looks up the connector and returns its normalized result, writing no audit entry (no company scope)", async () => {
    const { handleWebhook } = await import("./connector-connection.service");
    const result = await handleWebhook("custom-api", { foo: "bar" });

    expect(fakeContract.onWebhook).toHaveBeenCalledWith({ foo: "bar" });
    expect(result).toEqual({ receivedAt: "now" });
    expect(writeAuditInTransactionMock).not.toHaveBeenCalled();
  });

  it("throws ConnectorNotRegisteredError for an unknown connector", async () => {
    getConnectorContractMock.mockReturnValue(null);
    const { handleWebhook, ConnectorNotRegisteredError } = await import("./connector-connection.service");

    await expect(handleWebhook("ghost", {})).rejects.toThrow(ConnectorNotRegisteredError);
  });
});

describe("syncConnector", () => {
  it("throws ConnectorNotRegisteredError when the connector isn't in the registry", async () => {
    getConnectorContractMock.mockReturnValue(null);
    const { syncConnector, ConnectorNotRegisteredError } = await import("./connector-connection.service");

    await expect(syncConnector("company-1", "ghost")).rejects.toThrow(ConnectorNotRegisteredError);
  });

  it("throws ConnectorNotConnectedError when there's no connected connection", async () => {
    getConnectorConnectionMock.mockResolvedValue(null);
    const { syncConnector, ConnectorNotConnectedError } = await import("./connector-connection.service");

    await expect(syncConnector("company-1", "shopify")).rejects.toThrow(ConnectorNotConnectedError);
  });

  it("resolves the credential, gathers+reserves unmapped completed orders, syncs, and records products/pushed orders", async () => {
    getConnectorConnectionMock.mockResolvedValue({
      connectorId: "shopify",
      status: "connected",
      credentialRef: "projects/p/secrets/s/versions/1",
      config: { shopDomain: "shop.myshopify.com" },
    });
    resolveConnectorCredentialMock.mockResolvedValue("shpat_abc");
    listBranchesMock.mockResolvedValue([{ id: "branch-1", name: "Main", isActive: true, isDefault: true }]);
    listOrdersForBranchMock.mockResolvedValue([
      { id: "order-1", status: "completed", totals: { total: 10 } },
      { id: "order-2", status: "pending", totals: { total: 5 } },
    ]);
    getOutboundOrderMappingMock.mockResolvedValue(null);
    reserveOutboundOrderMock.mockResolvedValue(true);
    listOrderLinesMock.mockResolvedValue([{ id: "line-1", itemId: "item-1", itemNameSnapshot: "Widget", quantity: 2, unitPrice: 5 }]);
    getItemMock.mockResolvedValue({ id: "item-1", sku: "W-1" });
    getProductMappingMock.mockResolvedValue(null);
    createItemMock.mockResolvedValue({ id: "new-item-1" });

    fakeContract.sync.mockResolvedValue({
      syncedAt: "2026-01-01T00:00:00.000Z",
      products: [{ externalId: "ext-1", name: "Gizmo", sku: "G-1", price: 9.99, quantity: 3 }],
      pushedOrders: [{ orderId: "order-1", externalOrderId: "999" }],
      failedOrderIds: [],
    });

    const { syncConnector } = await import("./connector-connection.service");
    const summary = await syncConnector("company-1", "shopify");

    expect(resolveConnectorCredentialMock).toHaveBeenCalledWith("projects/p/secrets/s/versions/1");
    expect(reserveOutboundOrderMock).toHaveBeenCalledWith("company-1", "shopify", "order-1", expect.any(String));
    expect(reserveOutboundOrderMock).not.toHaveBeenCalledWith("company-1", "shopify", "order-2", expect.any(String));
    expect(fakeContract.sync).toHaveBeenCalledWith({
      credential: "shpat_abc",
      config: { shopDomain: "shop.myshopify.com" },
      outboundOrders: [{ orderId: "order-1", lines: [{ sku: "W-1", name: "Widget", quantity: 2, unitPrice: 5 }], total: 10 }],
    });
    expect(finalizePushedOrderMock).toHaveBeenCalledWith("company-1", "shopify", "order-1", "999", "2026-01-01T00:00:00.000Z");
    expect(createItemMock).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ sku: "G-1", name: "Gizmo", defaultPrice: 9.99 }),
    );
    expect(setProductMappingMock).toHaveBeenCalledWith("company-1", "shopify", "ext-1", "new-item-1", 3, "2026-01-01T00:00:00.000Z");
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.synced", after: { productsSynced: 1, ordersPushed: 1, ordersFailed: 0 } }),
    );
    expect(summary).toEqual({ syncedAt: "2026-01-01T00:00:00.000Z", productsSynced: 1, ordersPushed: 1, ordersFailed: 0 });
  });

  it("releases every reservation this run made when the connector's sync() throws", async () => {
    getConnectorConnectionMock.mockResolvedValue({ connectorId: "shopify", status: "connected", config: {} });
    listBranchesMock.mockResolvedValue([{ id: "branch-1", name: "Main", isActive: true, isDefault: true }]);
    listOrdersForBranchMock.mockResolvedValue([{ id: "order-1", status: "completed", totals: { total: 10 } }]);
    getOutboundOrderMappingMock.mockResolvedValue(null);
    reserveOutboundOrderMock.mockResolvedValue(true);
    listOrderLinesMock.mockResolvedValue([]);
    fakeContract.sync.mockRejectedValue(new Error("network down"));

    const { syncConnector } = await import("./connector-connection.service");
    await expect(syncConnector("company-1", "shopify")).rejects.toThrow("network down");

    expect(releaseReservationMock).toHaveBeenCalledWith("company-1", "shopify", "order-1");
  });

  it("releases a reservation the connector silently dropped (neither pushed nor reported failed)", async () => {
    getConnectorConnectionMock.mockResolvedValue({ connectorId: "shopify", status: "connected", config: {} });
    listBranchesMock.mockResolvedValue([{ id: "branch-1", name: "Main", isActive: true, isDefault: true }]);
    listOrdersForBranchMock.mockResolvedValue([{ id: "order-1", status: "completed", totals: { total: 10 } }]);
    getOutboundOrderMappingMock.mockResolvedValue(null);
    reserveOutboundOrderMock.mockResolvedValue(true);
    listOrderLinesMock.mockResolvedValue([]);
    fakeContract.sync.mockResolvedValue({ syncedAt: "now", pushedOrders: [], failedOrderIds: [] });

    const { syncConnector } = await import("./connector-connection.service");
    await syncConnector("company-1", "shopify");

    expect(releaseReservationMock).toHaveBeenCalledWith("company-1", "shopify", "order-1");
    expect(finalizePushedOrderMock).not.toHaveBeenCalled();
  });
});
