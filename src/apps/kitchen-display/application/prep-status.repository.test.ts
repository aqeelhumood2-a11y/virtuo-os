import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const docSetMock = vi.fn();
const collectionGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: docGetMock, set: (...args: unknown[]) => docSetMock(...args) }),
              where: () => ({ get: collectionGetMock }),
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

describe("getPrepStatus", () => {
  it("returns null when no status doc exists", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getPrepStatus } = await import("./prep-status.repository");

    await expect(getPrepStatus("company-1", "order-1")).resolves.toBeNull();
  });

  it("maps a stored doc back to a PrepStatus", async () => {
    docGetMock.mockResolvedValue({ exists: true, id: "order-1", data: () => ({ branchId: "branch-1", stage: "preparing", updatedBy: "uid-1" }) });
    const { getPrepStatus } = await import("./prep-status.repository");

    await expect(getPrepStatus("company-1", "order-1")).resolves.toEqual({
      orderId: "order-1",
      branchId: "branch-1",
      stage: "preparing",
      updatedBy: "uid-1",
    });
  });
});

describe("listPrepStatusForBranch", () => {
  it("maps every matching doc", async () => {
    collectionGetMock.mockResolvedValue({
      docs: [{ id: "order-1", data: () => ({ branchId: "branch-1", stage: "queued", updatedBy: "uid-1" }) }],
    });
    const { listPrepStatusForBranch } = await import("./prep-status.repository");

    await expect(listPrepStatusForBranch("company-1", "branch-1")).resolves.toEqual([
      { orderId: "order-1", branchId: "branch-1", stage: "queued", updatedBy: "uid-1" },
    ]);
  });
});

describe("setPrepStage", () => {
  it("writes a merge:true set with the new stage", async () => {
    const { setPrepStage } = await import("./prep-status.repository");

    await setPrepStage("company-1", "order-1", "branch-1", "ready", "uid-1");

    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: "branch-1", stage: "ready", updatedBy: "uid-1" }),
      { merge: true },
    );
  });
});
