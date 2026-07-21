import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const docSetMock = vi.fn();
const docDeleteMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                get: docGetMock,
                set: (...args: unknown[]) => docSetMock(...args),
                delete: (...args: unknown[]) => docDeleteMock(...args),
              }),
            }),
          }),
        }),
      }),
    }),
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const fakeTransaction = {
        get: async (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (...args: unknown[]) => void }, data: unknown) => ref.set(data),
      };
      return fn(fakeTransaction);
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOutboundOrderMapping", () => {
  it("returns null when no mapping exists", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getOutboundOrderMapping } = await import("./order-mapping.repository");

    await expect(getOutboundOrderMapping("company-1", "shopify", "order-1")).resolves.toBeNull();
  });

  it("maps a stored doc back to an OutboundOrderMapping", async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      id: "order-1",
      data: () => ({ status: "pushed", externalOrderId: "999", reservedAt: "2026-01-01T00:00:00.000Z", pushedAt: "2026-01-01T00:00:01.000Z" }),
    });
    const { getOutboundOrderMapping } = await import("./order-mapping.repository");

    await expect(getOutboundOrderMapping("company-1", "shopify", "order-1")).resolves.toEqual({
      orderId: "order-1",
      status: "pushed",
      externalOrderId: "999",
      reservedAt: "2026-01-01T00:00:00.000Z",
      pushedAt: "2026-01-01T00:00:01.000Z",
    });
  });
});

describe("reserveOutboundOrder", () => {
  it("reserves and returns true when no mapping exists yet", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { reserveOutboundOrder } = await import("./order-mapping.repository");

    await expect(reserveOutboundOrder("company-1", "shopify", "order-1", "2026-01-01T00:00:00.000Z")).resolves.toBe(true);
    expect(docSetMock).toHaveBeenCalledWith({ status: "reserved", reservedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("returns false without writing when already reserved/pushed (the race guard)", async () => {
    docGetMock.mockResolvedValue({ exists: true });
    const { reserveOutboundOrder } = await import("./order-mapping.repository");

    await expect(reserveOutboundOrder("company-1", "shopify", "order-1", "2026-01-01T00:00:00.000Z")).resolves.toBe(false);
    expect(docSetMock).not.toHaveBeenCalled();
  });
});

describe("finalizePushedOrder", () => {
  it("writes a merge:true set marking the order pushed", async () => {
    const { finalizePushedOrder } = await import("./order-mapping.repository");

    await finalizePushedOrder("company-1", "shopify", "order-1", "999", "2026-01-01T00:00:01.000Z");

    expect(docSetMock).toHaveBeenCalledWith(
      { status: "pushed", externalOrderId: "999", pushedAt: "2026-01-01T00:00:01.000Z" },
      { merge: true },
    );
  });
});

describe("releaseReservation", () => {
  it("deletes the reservation doc", async () => {
    const { releaseReservation } = await import("./order-mapping.repository");

    await releaseReservation("company-1", "shopify", "order-1");

    expect(docDeleteMock).toHaveBeenCalled();
  });
});
