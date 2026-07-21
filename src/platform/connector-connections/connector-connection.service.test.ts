import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformCapabilityMock = vi.fn();
const getConnectorContractMock = vi.fn();
const isConnectorEntitledMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

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

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: () => docGetMock(), set: (...args: unknown[]) => docSetMock(...args) }),
        }),
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
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
  connect: vi.fn(async () => ({ status: "connected" as const })),
  disconnect: vi.fn(async () => {}),
  sync: vi.fn(async () => ({ syncedAt: "now" })),
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
});

describe("connectConnector", () => {
  it("requires connectors.manage, checks the registry and entitlement, calls the pure connector, then persists+audits", async () => {
    const { connectConnector } = await import("./connector-connection.service");
    await connectConnector("company-1", "custom-api", { apiKey: "x" });

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "connectors.manage");
    expect(getConnectorContractMock).toHaveBeenCalledWith("custom-api");
    expect(isConnectorEntitledMock).toHaveBeenCalledWith("company-1", "custom-api");
    expect(fakeContract.connect).toHaveBeenCalledWith({ apiKey: "x" });
    expect(docSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "connected" }), { merge: true });
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.connected", targetType: "connectorConnection" }),
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
  it("requires connectors.manage, calls the pure connector's disconnect, then persists+audits", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected" }) });
    const { disconnectConnector } = await import("./connector-connection.service");

    await disconnectConnector("company-1", "custom-api");

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "connectors.manage");
    expect(fakeContract.disconnect).toHaveBeenCalledTimes(1);
    expect(docSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "disconnected" }), { merge: true });
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.disconnected", before: { status: "connected" } }),
    );
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
