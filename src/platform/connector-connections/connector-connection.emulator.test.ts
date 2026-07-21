// @vitest-environment node
//
// Pinned to node for the same reason as inventory-engine's
// stock.emulator.test.ts (see docs/phases/PHASE_1E_PLAN.md §10).
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const requireSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

async function seedCompanyAndLicense(companyId: string, ownerUid: string, entitledConnectors: string[] = []) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: ownerUid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(ownerUid)
    .set({ uid: ownerUid, role: "Owner", branchIds: [], status: "active" });
  await adminDb.collection("companies").doc(companyId).collection("licenses").doc("default").set({
    plan: "pro",
    entitledApps: [],
    entitledConnectors,
    seats: 5,
    renewsAt: null,
  });
}

describe.skipIf(!IS_EMULATOR)("platform/connector-connections (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connects the stub connector atomically with its audit entry", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, ["custom-api"]);
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { connectConnector } = await import("./connector-connection.service");
    const { getConnectorConnection } = await import("./connector-connection.repository");

    await connectConnector(companyId, "custom-api", {});

    const connection = await getConnectorConnection(companyId, "custom-api");
    expect(connection?.status).toBe("connected");

    const { listAuditLogs } = await import("@/core/audit-logs");
    const logs = await listAuditLogs(companyId);
    const entry = logs.find((log) => log.action === "connector.connected");
    expect(entry).toBeDefined();
    expect(entry?.targetType).toBe("connectorConnection");
    expect(entry?.targetId).toBe("custom-api");
  });

  it("throws ConnectorNotEntitledError and writes nothing when the plan doesn't include the connector", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, []);
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { connectConnector, ConnectorNotEntitledError } = await import("./connector-connection.service");
    const { getConnectorConnection } = await import("./connector-connection.repository");

    await expect(connectConnector(companyId, "custom-api", {})).rejects.toThrow(ConnectorNotEntitledError);
    await expect(getConnectorConnection(companyId, "custom-api")).resolves.toBeNull();
  });

  it("disconnects a connected connector, writing a connector.disconnected entry", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    await seedCompanyAndLicense(companyId, ownerUid, ["custom-api"]);
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    const { connectConnector, disconnectConnector } = await import("./connector-connection.service");
    const { getConnectorConnection } = await import("./connector-connection.repository");

    await connectConnector(companyId, "custom-api", {});
    await disconnectConnector(companyId, "custom-api");

    const connection = await getConnectorConnection(companyId, "custom-api");
    expect(connection?.status).toBe("disconnected");

    const { listAuditLogs } = await import("@/core/audit-logs");
    const logs = await listAuditLogs(companyId);
    expect(logs.some((log) => log.action === "connector.disconnected")).toBe(true);
  });

  it("handleWebhook round-trips through the real registered stub connector", async () => {
    const { handleWebhook } = await import("./connector-connection.service");
    const result = await handleWebhook("custom-api", { hello: "world" });
    expect(result.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
