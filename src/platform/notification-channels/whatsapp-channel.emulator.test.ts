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
const fetchMock = vi.fn();

// platform/secrets talks to real Google Secret Manager, which has no
// emulator; it's mocked here the same way the rest of this suite avoids
// any live external network call, while every Firestore transaction and
// every Core notification read below is real. See Phase 5's own
// connector-connection.sync.emulator.test.ts for the same "fake only the
// one non-Firestore boundary" precedent.
const secretStore = new Map<string, string>();
vi.mock("../secrets", () => ({
  storeConnectorCredential: async (companyId: string, connectorId: string, value: string) => {
    const ref = `fake-secret/${companyId}/${connectorId}`;
    secretStore.set(ref, value);
    return ref;
  },
  resolveConnectorCredential: async (ref: string) => secretStore.get(ref),
  deleteConnectorCredential: async (companyId: string, connectorId: string) => {
    secretStore.delete(`fake-secret/${companyId}/${connectorId}`);
  },
}));

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

async function seedCompanyAndNotification(companyId: string, ownerUid: string) {
  const { adminDb } = await import("@/lib/firebase/admin");
  await adminDb.collection("companies").doc(companyId).set({ name: "Acme", ownerId: ownerUid, status: "active" });
  await adminDb
    .collection("companies")
    .doc(companyId)
    .collection("memberships")
    .doc(ownerUid)
    .set({ uid: ownerUid, role: "Owner", branchIds: [], status: "active" });

  const { createNotification } = await import("@/core/notifications");
  await createNotification(ownerUid, { title: "App installed", body: "restaurant is now enabled." });
}

describe.skipIf(!IS_EMULATOR)("platform/notification-channels WhatsApp (Firestore Emulator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secretStore.clear();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connects, mirrors a real notification once, and is idempotent on re-sync", async () => {
    const companyId = `company-${randomUUID()}`;
    const ownerUid = `uid-${randomUUID()}`;
    requireSessionMock.mockResolvedValue({ uid: ownerUid, email: null, superAdmin: false });

    await seedCompanyAndNotification(companyId, ownerUid);

    const { connectWhatsAppChannel, syncWhatsAppNotifications } = await import("./whatsapp-channel.service");

    await connectWhatsAppChannel(companyId, { phoneNumberId: "123", accessToken: "tok", toPhoneNumber: "15551234567" });
    expect(fetchMock).toHaveBeenCalledWith("https://graph.facebook.com/v20.0/123", expect.anything());

    const firstSummary = await syncWhatsAppNotifications(companyId);
    expect(firstSummary.messagesSent).toBe(1);

    const secondSummary = await syncWhatsAppNotifications(companyId);
    expect(secondSummary.messagesSent).toBe(0);

    const messageSends = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith("/123/messages"));
    expect(messageSends).toHaveLength(1);

    const { listAuditLogs } = await import("@/core/audit-logs");
    const logs = await listAuditLogs(companyId);
    expect(logs.some((log) => log.action === "notificationChannel.connected")).toBe(true);
    expect(logs.filter((log) => log.action === "notificationChannel.synced")).toHaveLength(2);
  }, 20000);
});
