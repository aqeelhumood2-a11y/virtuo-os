import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const docSetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: docGetMock, set: (...args: unknown[]) => docSetMock(...args) }),
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

describe("getSyncCursorId", () => {
  it("returns null when no cursor doc exists yet (first run)", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getSyncCursorId } = await import("./sync-cursor.repository");

    await expect(getSyncCursorId("company-1")).resolves.toBeNull();
  });

  it("returns the stored lastProcessedLogId", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ lastProcessedLogId: "log-42" }) });
    const { getSyncCursorId } = await import("./sync-cursor.repository");

    await expect(getSyncCursorId("company-1")).resolves.toBe("log-42");
  });
});

describe("setSyncCursorId", () => {
  it("writes a merge:true set with the new cursor id", async () => {
    const { setSyncCursorId } = await import("./sync-cursor.repository");

    await setSyncCursorId("company-1", "log-99");

    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastProcessedLogId: "log-99" }),
      { merge: true },
    );
  });
});
