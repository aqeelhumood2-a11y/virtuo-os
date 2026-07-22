import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn();
const collectionGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ set: (...args: unknown[]) => setMock(...args) }),
              orderBy: () => ({ limit: () => ({ get: () => collectionGetMock() }) }),
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

describe("addQueryLogEntry", () => {
  it("writes the question/answer/actorId", async () => {
    const { addQueryLogEntry } = await import("./query-log.repository");

    await addQueryLogEntry("company-1", "How many widgets?", "You have 5 widgets.", "uid-1");

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ question: "How many widgets?", answer: "You have 5 widgets.", actorId: "uid-1" }),
    );
  });
});

describe("listRecentQueryLog", () => {
  it("maps every returned doc", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [{ id: "log-1", data: () => ({ question: "Q", answer: "A", actorId: "uid-1" }) }],
    });
    const { listRecentQueryLog } = await import("./query-log.repository");

    await expect(listRecentQueryLog("company-1", 10)).resolves.toEqual([{ id: "log-1", question: "Q", answer: "A", actorId: "uid-1" }]);
  });
});
