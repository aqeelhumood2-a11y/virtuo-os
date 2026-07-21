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
              orderBy: () => ({ limit: () => ({ get: collectionGetMock }) }),
              where: () => ({ limit: () => ({ get: collectionGetMock }) }),
            }),
          }),
        }),
      }),
    }),
  },
}));

function fakeMetaData(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "order-1",
    branchId: "branch-1",
    orderType: "dineIn",
    tableRef: "Table 4",
    guestCount: 2,
    kitchenNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrderMeta", () => {
  it("returns null when the doc doesn't exist", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getOrderMeta } = await import("./order-meta.repository");

    await expect(getOrderMeta("company-1", "draft-1")).resolves.toBeNull();
  });

  it("maps an existing doc, defaulting optional fields to null", async () => {
    docGetMock.mockResolvedValue({ exists: true, id: "draft-1", data: () => fakeMetaData({ tableRef: undefined }) });
    const { getOrderMeta } = await import("./order-meta.repository");

    await expect(getOrderMeta("company-1", "draft-1")).resolves.toEqual({
      draftId: "draft-1",
      orderId: "order-1",
      branchId: "branch-1",
      orderType: "dineIn",
      tableRef: null,
      guestCount: 2,
      kitchenNote: null,
      status: "confirmed",
    });
  });
});

describe("getOrderMetaByOrderId", () => {
  it("returns null when no matching doc exists", async () => {
    collectionGetMock.mockResolvedValue({ empty: true, docs: [] });
    const { getOrderMetaByOrderId } = await import("./order-meta.repository");

    await expect(getOrderMetaByOrderId("company-1", "order-1")).resolves.toBeNull();
  });

  it("maps the single matching doc", async () => {
    collectionGetMock.mockResolvedValue({
      empty: false,
      docs: [{ id: "draft-1", data: () => fakeMetaData() }],
    });
    const { getOrderMetaByOrderId } = await import("./order-meta.repository");

    const result = await getOrderMetaByOrderId("company-1", "order-1");
    expect(result?.draftId).toBe("draft-1");
    expect(result?.orderId).toBe("order-1");
  });
});

describe("setOrderMetaInTransaction", () => {
  it("writes a merge:true set with status confirmed", async () => {
    const { setOrderMetaInTransaction } = await import("./order-meta.repository");
    const fakeTransaction = { set: (ref: unknown, data: unknown, opts: unknown) => docSetMock(data, opts) };

    setOrderMetaInTransaction(fakeTransaction as never, "company-1", "draft-1", {
      orderId: "order-1",
      branchId: "branch-1",
      orderType: "takeaway",
      tableRef: null,
      guestCount: null,
      kitchenNote: null,
    });

    expect(docSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", orderType: "takeaway", status: "confirmed" }),
      { merge: true },
    );
  });
});

describe("listRecentOrderMeta", () => {
  it("maps every returned doc", async () => {
    collectionGetMock.mockResolvedValue({ docs: [{ id: "draft-1", data: () => fakeMetaData() }] });
    const { listRecentOrderMeta } = await import("./order-meta.repository");

    const result = await listRecentOrderMeta("company-1", 50);
    expect(result).toHaveLength(1);
    expect(result[0].draftId).toBe("draft-1");
  });
});
