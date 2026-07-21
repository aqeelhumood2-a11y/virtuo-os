import { beforeEach, describe, expect, it, vi } from "vitest";

const whereGetMock = vi.fn();
const transactionSetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ set: (...args: unknown[]) => transactionSetMock(...args) }),
              where: () => ({
                limit: () => ({ get: whereGetMock }),
                orderBy: () => ({ get: whereGetMock }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

function fakeEntryData(overrides: Record<string, unknown> = {}) {
  return { memberId: "member-1", type: "earned", points: 10, orderId: "order-1", reason: null, actorId: "owner-1", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLedgerEntryByOrderId", () => {
  it("returns null when no matching entry exists", async () => {
    whereGetMock.mockResolvedValue({ empty: true, docs: [] });
    const { getLedgerEntryByOrderId } = await import("./ledger.repository");

    await expect(getLedgerEntryByOrderId("company-1", "order-1")).resolves.toBeNull();
  });

  it("maps the single matching entry", async () => {
    whereGetMock.mockResolvedValue({ empty: false, docs: [{ id: "entry-1", data: () => fakeEntryData() }] });
    const { getLedgerEntryByOrderId } = await import("./ledger.repository");

    await expect(getLedgerEntryByOrderId("company-1", "order-1")).resolves.toEqual({
      id: "entry-1",
      memberId: "member-1",
      type: "earned",
      points: 10,
      orderId: "order-1",
      reason: null,
      actorId: "owner-1",
    });
  });
});

describe("listLedgerForMember", () => {
  it("maps every returned entry", async () => {
    whereGetMock.mockResolvedValue({ docs: [{ id: "entry-1", data: () => fakeEntryData() }] });
    const { listLedgerForMember } = await import("./ledger.repository");

    const result = await listLedgerForMember("company-1", "member-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("entry-1");
  });
});

describe("appendLedgerEntryInTransaction", () => {
  it("writes the entry as given", async () => {
    const { appendLedgerEntryInTransaction } = await import("./ledger.repository");
    const fakeTransaction = { set: (ref: unknown, data: unknown) => transactionSetMock(data) };

    appendLedgerEntryInTransaction(fakeTransaction as never, "company-1", {
      memberId: "member-1",
      type: "earned",
      points: 5,
      orderId: "order-2",
      reason: null,
      actorId: "owner-1",
    });

    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member-1", type: "earned", points: 5, orderId: "order-2" }),
    );
  });
});
