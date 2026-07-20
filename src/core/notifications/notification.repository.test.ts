import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendInAppMock = vi.fn();
const sendInAppInTransactionMock = vi.fn();
const notificationsCollectionMock = vi.fn();

const docUpdateMock = vi.fn();
const whereGetMock = vi.fn();
const collectionGetMock = vi.fn();
const batchUpdateMock = vi.fn();
const batchCommitMock = vi.fn();

vi.mock("./channels/in-app", () => ({
  sendInApp: (...args: unknown[]) => sendInAppMock(...args),
  sendInAppInTransaction: (...args: unknown[]) => sendInAppInTransactionMock(...args),
  notificationsCollection: (...args: unknown[]) => notificationsCollectionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    batch: () => ({
      update: (...args: unknown[]) => batchUpdateMock(...args),
      commit: () => batchCommitMock(),
    }),
  },
}));

beforeEach(() => {
  vi.resetModules();
  notificationsCollectionMock.mockReturnValue({
    doc: () => ({ update: (...args: unknown[]) => docUpdateMock(...args) }),
    where: () => ({ get: () => whereGetMock() }),
    get: () => collectionGetMock(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createNotification / createNotificationInTransaction", () => {
  it("createNotification delegates to sendInApp", async () => {
    const { createNotification } = await import("./notification.repository");
    await createNotification("uid-1", { title: "Hi", body: "There" });

    expect(sendInAppMock).toHaveBeenCalledWith("uid-1", { title: "Hi", body: "There" });
  });

  it("createNotificationInTransaction delegates to sendInAppInTransaction", async () => {
    const { createNotificationInTransaction } = await import("./notification.repository");
    const fakeTransaction = {};
    createNotificationInTransaction(fakeTransaction as never, "uid-1", { title: "Hi", body: "There" });

    expect(sendInAppInTransactionMock).toHaveBeenCalledWith(fakeTransaction, "uid-1", { title: "Hi", body: "There" });
  });
});

describe("listNotifications", () => {
  it("maps documents, deriving read from whether readAt is set", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [
        {
          id: "n-1",
          data: () => ({ title: "Hi", body: "There", channel: "in-app", readAt: null }),
        },
        {
          id: "n-2",
          data: () => ({
            title: "Hey",
            body: "You",
            channel: "in-app",
            readAt: { seconds: 1 },
            relatedEntity: { type: "order", id: "order-1" },
          }),
        },
      ],
    });
    const { listNotifications } = await import("./notification.repository");

    const result = await listNotifications("uid-1");
    expect(result).toEqual([
      { id: "n-1", title: "Hi", body: "There", channel: "in-app", read: false, relatedEntity: undefined },
      {
        id: "n-2",
        title: "Hey",
        body: "You",
        channel: "in-app",
        read: true,
        relatedEntity: { type: "order", id: "order-1" },
      },
    ]);
  });

  it("filters to unread only when opts.unreadOnly is set", async () => {
    whereGetMock.mockResolvedValue({ docs: [] });
    const { listNotifications } = await import("./notification.repository");

    await listNotifications("uid-1", { unreadOnly: true });
    expect(whereGetMock).toHaveBeenCalled();
    expect(collectionGetMock).not.toHaveBeenCalled();
  });
});

describe("markAsRead", () => {
  it("sets readAt on the target notification doc", async () => {
    const { markAsRead } = await import("./notification.repository");
    await markAsRead("uid-1", "n-1");

    expect(docUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.anything() }));
  });
});

describe("markAllAsRead", () => {
  it("batch-updates every unread doc and commits", async () => {
    whereGetMock.mockResolvedValue({
      empty: false,
      docs: [{ ref: "ref-1" }, { ref: "ref-2" }],
    });
    const { markAllAsRead } = await import("./notification.repository");

    await markAllAsRead("uid-1");

    expect(batchUpdateMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, "ref-1", expect.objectContaining({ readAt: expect.anything() }));
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when there are no unread notifications", async () => {
    whereGetMock.mockResolvedValue({ empty: true, docs: [] });
    const { markAllAsRead } = await import("./notification.repository");

    await markAllAsRead("uid-1");

    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
