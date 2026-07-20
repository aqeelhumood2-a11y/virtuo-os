import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const docSetMock = vi.fn();
const docWhereGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ set: (...args: unknown[]) => docSetMock(...args) }),
          where: () => ({ get: () => docWhereGetMock() }),
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

describe("sendInAppInTransaction", () => {
  it("writes the notification doc via transaction.set with readAt null and channel in-app", async () => {
    const { sendInAppInTransaction } = await import("./in-app");
    const transactionSetMock = vi.fn();
    const fakeTransaction = { set: (...args: unknown[]) => transactionSetMock(...args) };

    sendInAppInTransaction(fakeTransaction as never, "uid-1", {
      title: "Your role was updated",
      body: "Your role is now Manager.",
      relatedEntity: { type: "membership", id: "uid-1" },
    });

    expect(transactionSetMock).toHaveBeenCalledTimes(1);
    const [, doc] = transactionSetMock.mock.calls[0];
    expect(doc).toMatchObject({
      title: "Your role was updated",
      body: "Your role is now Manager.",
      channel: "in-app",
      readAt: null,
      relatedEntity: { type: "membership", id: "uid-1" },
    });
    expect(doc.createdAt).toBeDefined();
  });

  it("defaults relatedEntity to null when omitted", async () => {
    const { sendInAppInTransaction } = await import("./in-app");
    const transactionSetMock = vi.fn();
    const fakeTransaction = { set: (...args: unknown[]) => transactionSetMock(...args) };

    sendInAppInTransaction(fakeTransaction as never, "uid-1", { title: "Hi", body: "There" });

    const [, doc] = transactionSetMock.mock.calls[0];
    expect(doc.relatedEntity).toBeNull();
  });
});

describe("sendInApp", () => {
  it("persists the notification doc directly, outside any transaction", async () => {
    const { sendInApp } = await import("./in-app");
    await sendInApp("uid-1", { title: "Hi", body: "There" });

    expect(docSetMock).toHaveBeenCalledTimes(1);
    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hi", body: "There", channel: "in-app", readAt: null }),
    );
  });
});
