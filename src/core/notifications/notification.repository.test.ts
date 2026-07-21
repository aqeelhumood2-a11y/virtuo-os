import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendInAppMock = vi.fn();
const sendInAppInTransactionMock = vi.fn();
const notificationsCollectionMock = vi.fn();

const docUpdateMock = vi.fn();
const docGetMock = vi.fn();
const whereGetMock = vi.fn();
const collectionGetMock = vi.fn();
const whereMock = vi.fn();
const orderByMock = vi.fn();
const limitMock = vi.fn();
const startAfterMock = vi.fn();
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

// A chainable fake query, same shape as core/audit-logs' equivalent mock:
// orderBy()/limit()/startAfter() each return the same ref so they compose,
// while `terminalGetMock` lets a `.where(...)`-derived chain and a plain
// chain resolve to two distinct spies -- preserving the existing
// whereGetMock/collectionGetMock distinction the pre-pagination tests rely
// on (filtered vs. unfiltered reads).
function makeChain(terminalGetMock: () => unknown) {
  const ref = {
    get: () => terminalGetMock(),
    orderBy: (...args: unknown[]) => {
      orderByMock(...args);
      return ref;
    },
    limit: (...args: unknown[]) => {
      limitMock(...args);
      return ref;
    },
    startAfter: (...args: unknown[]) => {
      startAfterMock(...args);
      return ref;
    },
  };
  return ref;
}

beforeEach(() => {
  vi.resetModules();
  docGetMock.mockResolvedValue({ exists: false });
  notificationsCollectionMock.mockReturnValue({
    doc: (id?: string) => ({
      id: id ?? "generated-notif-id",
      update: (...args: unknown[]) => docUpdateMock(...args),
      get: () => docGetMock(),
    }),
    get: () => collectionGetMock(),
    where: (...args: unknown[]) => {
      whereMock(...args);
      return makeChain(whereGetMock);
    },
    orderBy: (...args: unknown[]) => {
      orderByMock(...args);
      return makeChain(collectionGetMock);
    },
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

describe("listNotificationsPage", () => {
  it("orders newest-first and limits to the requested page size, unfiltered by default", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listNotificationsPage } = await import("./notification.repository");

    await listNotificationsPage("uid-1", { limit: 10 });

    expect(orderByMock).toHaveBeenCalledWith("createdAt", "desc");
    expect(limitMock).toHaveBeenCalledWith(10);
    expect(whereMock).not.toHaveBeenCalled();
  });

  it("applies the unread filter, still ordered and limited server-side, when unreadOnly is set", async () => {
    whereGetMock.mockResolvedValue({ docs: [] });
    const { listNotificationsPage } = await import("./notification.repository");

    await listNotificationsPage("uid-1", { unreadOnly: true, limit: 5 });

    expect(whereMock).toHaveBeenCalledWith("readAt", "==", null);
    expect(orderByMock).toHaveBeenCalledWith("createdAt", "desc");
    expect(limitMock).toHaveBeenCalledWith(5);
    expect(collectionGetMock).not.toHaveBeenCalled();
  });

  it("defaults to a page size of 50 when no limit is given", async () => {
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listNotificationsPage } = await import("./notification.repository");

    await listNotificationsPage("uid-1");
    expect(limitMock).toHaveBeenCalledWith(50);
  });

  it("returns nextCursor as the last item's id when a full page comes back", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [
        { id: "n-1", data: () => ({ title: "a", body: "b", channel: "in-app", readAt: null }) },
        { id: "n-2", data: () => ({ title: "a", body: "b", channel: "in-app", readAt: null }) },
      ],
    });
    const { listNotificationsPage } = await import("./notification.repository");

    const page = await listNotificationsPage("uid-1", { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("n-2");
  });

  it("returns nextCursor: null when fewer docs than the limit come back (last page)", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [{ id: "n-1", data: () => ({ title: "a", body: "b", channel: "in-app", readAt: null }) }],
    });
    const { listNotificationsPage } = await import("./notification.repository");

    const page = await listNotificationsPage("uid-1", { limit: 2 });
    expect(page.nextCursor).toBeNull();
  });

  it("resolves a given cursor to a document snapshot and passes it to startAfter", async () => {
    docGetMock.mockResolvedValue({ exists: true, id: "n-1" });
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listNotificationsPage } = await import("./notification.repository");

    await listNotificationsPage("uid-1", { cursor: "n-1" });
    expect(startAfterMock).toHaveBeenCalledWith({ exists: true, id: "n-1" });
  });

  it("ignores a cursor that no longer exists rather than throwing", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    collectionGetMock.mockResolvedValue({ docs: [] });
    const { listNotificationsPage } = await import("./notification.repository");

    await expect(listNotificationsPage("uid-1", { cursor: "ghost" })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(startAfterMock).not.toHaveBeenCalled();
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

  it("uses exactly one batch when the unread count is at the 500-op limit", async () => {
    const docs = Array.from({ length: 500 }, (_, i) => ({ ref: `ref-${i}` }));
    whereGetMock.mockResolvedValue({ empty: false, docs });
    const { markAllAsRead } = await import("./notification.repository");

    await markAllAsRead("uid-1");

    expect(batchUpdateMock).toHaveBeenCalledTimes(500);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it("splits more than 500 unread docs into multiple <=500-op batches", async () => {
    const docs = Array.from({ length: 600 }, (_, i) => ({ ref: `ref-${i}` }));
    whereGetMock.mockResolvedValue({ empty: false, docs });
    const { markAllAsRead } = await import("./notification.repository");

    await markAllAsRead("uid-1");

    expect(batchUpdateMock).toHaveBeenCalledTimes(600);
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
  });
});
