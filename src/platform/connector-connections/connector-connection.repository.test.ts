import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const collectionGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: () => getMock() }),
          get: () => collectionGetMock(),
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getConnectorConnection", () => {
  it("returns null when no doc exists", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { getConnectorConnection } = await import("./connector-connection.repository");

    await expect(getConnectorConnection("company-1", "custom-api")).resolves.toBeNull();
  });

  it("maps a connection doc", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected", lastSyncAt: "2026-01-01" }) });
    const { getConnectorConnection } = await import("./connector-connection.repository");

    await expect(getConnectorConnection("company-1", "custom-api")).resolves.toEqual({
      connectorId: "custom-api",
      status: "connected",
      lastSyncAt: "2026-01-01",
      credentialRef: undefined,
      config: undefined,
    });
  });
});

describe("listCompanyConnectors", () => {
  it("maps every connection doc", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [{ id: "custom-api", data: () => ({ status: "disconnected" }) }],
    });
    const { listCompanyConnectors } = await import("./connector-connection.repository");

    await expect(listCompanyConnectors("company-1")).resolves.toEqual([
      {
        connectorId: "custom-api",
        status: "disconnected",
        lastSyncAt: undefined,
        credentialRef: undefined,
        config: undefined,
      },
    ]);
  });

  it("returns an empty list when nothing has ever been connected", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listCompanyConnectors } = await import("./connector-connection.repository");

    await expect(listCompanyConnectors("company-1")).resolves.toEqual([]);
  });
});
