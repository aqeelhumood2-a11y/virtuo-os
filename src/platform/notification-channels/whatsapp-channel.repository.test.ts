import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const docSetMock = vi.fn();
const cursorGetMock = vi.fn();
const cursorSetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: docGetMock,
            set: (...args: unknown[]) => docSetMock(...args),
            collection: () => ({
              doc: () => ({ get: cursorGetMock, set: (...args: unknown[]) => cursorSetMock(...args) }),
            }),
          }),
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWhatsAppChannel", () => {
  it("returns null when no connection exists", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getWhatsAppChannel } = await import("./whatsapp-channel.repository");

    await expect(getWhatsAppChannel("company-1")).resolves.toBeNull();
  });

  it("maps a stored doc back to a WhatsAppChannelConnection", async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        status: "connected",
        lastSyncAt: "2026-01-01T00:00:00.000Z",
        credentialRef: "projects/p/secrets/s/versions/1",
        config: { phoneNumberId: "123", toPhoneNumber: "15551234567" },
      }),
    });
    const { getWhatsAppChannel } = await import("./whatsapp-channel.repository");

    await expect(getWhatsAppChannel("company-1")).resolves.toEqual({
      status: "connected",
      lastSyncAt: "2026-01-01T00:00:00.000Z",
      credentialRef: "projects/p/secrets/s/versions/1",
      config: { phoneNumberId: "123", toPhoneNumber: "15551234567" },
    });
  });
});

describe("getSyncCursor / setSyncCursor", () => {
  it("returns null when no cursor doc exists yet", async () => {
    cursorGetMock.mockResolvedValue({ exists: false });
    const { getSyncCursor } = await import("./whatsapp-channel.repository");

    await expect(getSyncCursor("company-1", "uid-1")).resolves.toBeNull();
  });

  it("returns the stored lastNotificationId", async () => {
    cursorGetMock.mockResolvedValue({ exists: true, data: () => ({ lastNotificationId: "notif-42" }) });
    const { getSyncCursor } = await import("./whatsapp-channel.repository");

    await expect(getSyncCursor("company-1", "uid-1")).resolves.toBe("notif-42");
  });

  it("writes a merge:true set with the new cursor id", async () => {
    const { setSyncCursor } = await import("./whatsapp-channel.repository");

    await setSyncCursor("company-1", "uid-1", "notif-99");

    expect(cursorSetMock).toHaveBeenCalledWith({ lastNotificationId: "notif-99" }, { merge: true });
  });
});
