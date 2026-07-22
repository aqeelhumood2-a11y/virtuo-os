import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformCapabilityMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();
const listCompanyMembersMock = vi.fn();
const listNotificationsPageMock = vi.fn();
const sendWhatsAppMessageMock = vi.fn();
const verifyWhatsAppCredentialMock = vi.fn();
const storeConnectorCredentialMock = vi.fn();
const resolveConnectorCredentialMock = vi.fn();
const deleteConnectorCredentialMock = vi.fn();
const getWhatsAppChannelMock = vi.fn();
const getSyncCursorMock = vi.fn();
const setSyncCursorMock = vi.fn();

const docGetMock = vi.fn();
const docSetMock = vi.fn();

vi.mock("../shared/require-platform-capability", () => ({
  requirePlatformCapability: (...args: unknown[]) => requirePlatformCapabilityMock(...args),
}));

vi.mock("@/core/audit-logs", () => ({
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

vi.mock("@/core/companies/membership", () => ({
  listCompanyMembers: (...args: unknown[]) => listCompanyMembersMock(...args),
}));

vi.mock("@/core/notifications", () => ({
  listNotificationsPage: (...args: unknown[]) => listNotificationsPageMock(...args),
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessageMock(...args),
  verifyWhatsAppCredential: (...args: unknown[]) => verifyWhatsAppCredentialMock(...args),
}));

vi.mock("../secrets", () => ({
  storeConnectorCredential: (...args: unknown[]) => storeConnectorCredentialMock(...args),
  resolveConnectorCredential: (...args: unknown[]) => resolveConnectorCredentialMock(...args),
  deleteConnectorCredential: (...args: unknown[]) => deleteConnectorCredentialMock(...args),
}));

vi.mock("./whatsapp-channel.repository", () => ({
  whatsAppChannelDoc: () => ({ get: () => docGetMock(), set: (...args: unknown[]) => docSetMock(...args) }),
  getWhatsAppChannel: (...args: unknown[]) => getWhatsAppChannelMock(...args),
  getSyncCursor: (...args: unknown[]) => getSyncCursorMock(...args),
  setSyncCursor: (...args: unknown[]) => setSyncCursorMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown, opts?: unknown) => ref.set(data, opts),
      };
      return fn(fakeTransaction);
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requirePlatformCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
  docGetMock.mockResolvedValue({ exists: false });
});

describe("connectWhatsAppChannel", () => {
  it("requires notificationChannels.manage, verifies the credential, stores it, then persists+audits", async () => {
    verifyWhatsAppCredentialMock.mockResolvedValue(undefined);
    storeConnectorCredentialMock.mockResolvedValue("projects/p/secrets/connector-company-1-whatsapp/versions/1");
    const { connectWhatsAppChannel } = await import("./whatsapp-channel.service");

    await connectWhatsAppChannel("company-1", { phoneNumberId: "123", accessToken: "tok", toPhoneNumber: "15551234567" });

    expect(requirePlatformCapabilityMock).toHaveBeenCalledWith("company-1", "notificationChannels.manage");
    expect(verifyWhatsAppCredentialMock).toHaveBeenCalledWith("123", "tok");
    expect(storeConnectorCredentialMock).toHaveBeenCalledWith("company-1", "whatsapp", "tok");
    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "connected",
        credentialRef: "projects/p/secrets/connector-company-1-whatsapp/versions/1",
        config: { phoneNumberId: "123", toPhoneNumber: "15551234567" },
      }),
      { merge: true },
    );
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "notificationChannel.connected", targetType: "notificationChannel" }),
    );
  });

  it("never stores a credential when verification fails", async () => {
    verifyWhatsAppCredentialMock.mockRejectedValue(new Error("401"));
    const { connectWhatsAppChannel } = await import("./whatsapp-channel.service");

    await expect(
      connectWhatsAppChannel("company-1", { phoneNumberId: "123", accessToken: "bad", toPhoneNumber: "15551234567" }),
    ).rejects.toThrow("401");
    expect(storeConnectorCredentialMock).not.toHaveBeenCalled();
    expect(docSetMock).not.toHaveBeenCalled();
  });
});

describe("disconnectWhatsAppChannel", () => {
  it("deletes the stored credential when the connection had one", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected", credentialRef: "ref-1" }) });
    const { disconnectWhatsAppChannel } = await import("./whatsapp-channel.service");

    await disconnectWhatsAppChannel("company-1");

    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disconnected", credentialRef: null }),
      { merge: true },
    );
    expect(deleteConnectorCredentialMock).toHaveBeenCalledWith("company-1", "whatsapp");
  });

  it("never touches Secret Manager when there was no stored credential", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ status: "connected" }) });
    const { disconnectWhatsAppChannel } = await import("./whatsapp-channel.service");

    await disconnectWhatsAppChannel("company-1");

    expect(deleteConnectorCredentialMock).not.toHaveBeenCalled();
  });
});

describe("syncWhatsAppNotifications", () => {
  it("throws WhatsAppChannelNotConnectedError when not connected", async () => {
    getWhatsAppChannelMock.mockResolvedValue(null);
    const { syncWhatsAppNotifications, WhatsAppChannelNotConnectedError } = await import("./whatsapp-channel.service");

    await expect(syncWhatsAppNotifications("company-1")).rejects.toThrow(WhatsAppChannelNotConnectedError);
  });

  it("mirrors only Owner/Manager admins' new notifications, oldest first, and advances each admin's own cursor", async () => {
    getWhatsAppChannelMock.mockResolvedValue({
      status: "connected",
      credentialRef: "ref-1",
      config: { phoneNumberId: "123", toPhoneNumber: "15551234567" },
    });
    resolveConnectorCredentialMock.mockResolvedValue("tok");
    listCompanyMembersMock.mockResolvedValue([
      { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
      { uid: "manager-1", role: "Manager", branchIds: [], status: "active" },
      { uid: "employee-1", role: "Employee", branchIds: [], status: "active" },
    ]);
    getSyncCursorMock.mockResolvedValue(null);
    listNotificationsPageMock.mockImplementation(async (uid: string) => {
      if (uid === "owner-1") {
        return {
          items: [
            { id: "n2", title: "Void", body: "Order voided", channel: "in-app", read: false },
            { id: "n1", title: "Install", body: "App installed", channel: "in-app", read: false },
          ],
          nextCursor: null,
        };
      }
      return { items: [], nextCursor: null };
    });
    sendWhatsAppMessageMock.mockResolvedValue(undefined);

    const { syncWhatsAppNotifications } = await import("./whatsapp-channel.service");
    const summary = await syncWhatsAppNotifications("company-1");

    expect(listNotificationsPageMock).toHaveBeenCalledWith("owner-1", expect.anything());
    expect(listNotificationsPageMock).toHaveBeenCalledWith("manager-1", expect.anything());
    expect(listNotificationsPageMock).not.toHaveBeenCalledWith("employee-1", expect.anything());

    // oldest-first send order despite the newest-first page
    expect(sendWhatsAppMessageMock.mock.calls.map((call) => call[1])).toEqual([
      "Install: App installed",
      "Void: Order voided",
    ]);
    expect(setSyncCursorMock).toHaveBeenCalledWith("company-1", "owner-1", "n2");
    expect(summary.messagesSent).toBe(2);
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "notificationChannel.synced", after: { messagesSent: 2 } }),
    );
  });

  it("stops walking backward once it reaches the stored cursor, and skips a failed send without aborting the rest", async () => {
    getWhatsAppChannelMock.mockResolvedValue({
      status: "connected",
      credentialRef: "ref-1",
      config: { phoneNumberId: "123", toPhoneNumber: "15551234567" },
    });
    resolveConnectorCredentialMock.mockResolvedValue("tok");
    listCompanyMembersMock.mockResolvedValue([{ uid: "owner-1", role: "Owner", branchIds: [], status: "active" }]);
    getSyncCursorMock.mockResolvedValue("n1");
    listNotificationsPageMock.mockResolvedValue({
      items: [
        { id: "n3", title: "New", body: "Newest", channel: "in-app", read: false },
        { id: "n2", title: "Mid", body: "Middle", channel: "in-app", read: false },
        { id: "n1", title: "Old", body: "Already synced", channel: "in-app", read: false },
      ],
      nextCursor: null,
    });
    sendWhatsAppMessageMock.mockRejectedValueOnce(new Error("send failed")).mockResolvedValueOnce(undefined);

    const { syncWhatsAppNotifications } = await import("./whatsapp-channel.service");
    const summary = await syncWhatsAppNotifications("company-1");

    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(2);
    expect(summary.messagesSent).toBe(1);
    expect(setSyncCursorMock).toHaveBeenCalledWith("company-1", "owner-1", "n3");
  });
});
