import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrderMock = vi.fn();
const listOrdersForBranchMock = vi.fn();
const getPrepStatusMock = vi.fn();
const listPrepStatusForBranchMock = vi.fn();
const setPrepStageMock = vi.fn();

vi.mock("@/core", () => ({
  getOrder: (...args: unknown[]) => getOrderMock(...args),
  listOrdersForBranch: (...args: unknown[]) => listOrdersForBranchMock(...args),
}));

vi.mock("./prep-status.repository", () => ({
  getPrepStatus: (...args: unknown[]) => getPrepStatusMock(...args),
  listPrepStatusForBranch: (...args: unknown[]) => listPrepStatusForBranchMock(...args),
  setPrepStage: (...args: unknown[]) => setPrepStageMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listQueueForBranch", () => {
  it("excludes voided orders and defaults an order with no status doc to queued", async () => {
    listOrdersForBranchMock.mockResolvedValue([
      { id: "order-1", branchId: "branch-1", appId: "restaurant", status: "completed", totals: { total: 10 } },
      { id: "order-2", branchId: "branch-1", appId: "restaurant", status: "voided", totals: { total: 5 } },
    ]);
    listPrepStatusForBranchMock.mockResolvedValue([{ orderId: "order-1", branchId: "branch-1", stage: "preparing", updatedBy: "uid-1" }]);

    const { listQueueForBranch } = await import("./kitchen-display.service");
    const result = await listQueueForBranch("company-1", "branch-1");

    expect(result).toEqual([{ order: expect.objectContaining({ id: "order-1" }), stage: "preparing" }]);
  });

  it("defaults to queued when no prep-status doc exists yet", async () => {
    listOrdersForBranchMock.mockResolvedValue([{ id: "order-1", branchId: "branch-1", appId: "retail", status: "completed", totals: { total: 10 } }]);
    listPrepStatusForBranchMock.mockResolvedValue([]);

    const { listQueueForBranch } = await import("./kitchen-display.service");
    const result = await listQueueForBranch("company-1", "branch-1");

    expect(result[0].stage).toBe("queued");
  });
});

describe("advanceStage", () => {
  it("re-derives branchId from Core's own getOrder and writes the new stage", async () => {
    getOrderMock.mockResolvedValue({ id: "order-1", branchId: "branch-1", appId: "restaurant", status: "completed", totals: { total: 10 } });

    const { advanceStage } = await import("./kitchen-display.service");
    await advanceStage("company-1", "order-1", "preparing", "uid-1");

    expect(getOrderMock).toHaveBeenCalledWith("company-1", "order-1");
    expect(setPrepStageMock).toHaveBeenCalledWith("company-1", "order-1", "branch-1", "preparing", "uid-1");
  });

  it("throws OrderNotFoundError when the order doesn't exist", async () => {
    getOrderMock.mockResolvedValue(null);
    const { advanceStage, OrderNotFoundError } = await import("./kitchen-display.service");

    await expect(advanceStage("company-1", "ghost", "preparing", "uid-1")).rejects.toThrow(OrderNotFoundError);
    expect(setPrepStageMock).not.toHaveBeenCalled();
  });
});

describe("getStageForOrder", () => {
  it("defaults to queued when no status doc exists", async () => {
    getPrepStatusMock.mockResolvedValue(null);
    const { getStageForOrder } = await import("./kitchen-display.service");

    await expect(getStageForOrder("company-1", "order-1")).resolves.toBe("queued");
  });
});
