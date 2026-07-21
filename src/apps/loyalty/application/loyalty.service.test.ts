import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrderMock = vi.fn();
const listAuditLogsPageMock = vi.fn();
const writeAuditInTransactionMock = vi.fn();

class FakeBranchAccessDeniedError extends Error {}

vi.mock("@/core", () => ({
  BranchAccessDeniedError: FakeBranchAccessDeniedError,
  getOrder: (...args: unknown[]) => getOrderMock(...args),
  listAuditLogsPage: (...args: unknown[]) => listAuditLogsPageMock(...args),
  writeAuditInTransaction: (...args: unknown[]) => writeAuditInTransactionMock(...args),
}));

const createMemberInTransactionMock = vi.fn();
const adjustMemberBalanceInTransactionMock = vi.fn();
const getMemberMock = vi.fn();
const listMembersMock = vi.fn();
const newMemberRefMock = vi.fn(() => ({ id: "new-member-id" }));

vi.mock("./member.repository", () => ({
  createMemberInTransaction: (...args: unknown[]) => createMemberInTransactionMock(...args),
  adjustMemberBalanceInTransaction: (...args: unknown[]) => adjustMemberBalanceInTransactionMock(...args),
  getMember: (...args: unknown[]) => getMemberMock(...args),
  listMembers: (...args: unknown[]) => listMembersMock(...args),
  newMemberRef: () => newMemberRefMock(),
}));

const appendLedgerEntryInTransactionMock = vi.fn();
const getLedgerEntryByOrderIdMock = vi.fn();
const listLedgerForMemberMock = vi.fn();

vi.mock("./ledger.repository", () => ({
  appendLedgerEntryInTransaction: (...args: unknown[]) => appendLedgerEntryInTransactionMock(...args),
  getLedgerEntryByOrderId: (...args: unknown[]) => getLedgerEntryByOrderIdMock(...args),
  listLedgerForMember: (...args: unknown[]) => listLedgerForMemberMock(...args),
}));

const attributionDocMock = vi.fn(() => ({ id: "attribution-ref" }));
const getAttributionMock = vi.fn();
const setAttributionInTransactionMock = vi.fn();

vi.mock("./attribution.repository", () => ({
  attributionDoc: () => attributionDocMock(),
  getAttribution: (...args: unknown[]) => getAttributionMock(...args),
  setAttributionInTransaction: (...args: unknown[]) => setAttributionInTransactionMock(...args),
}));

const getSyncCursorIdMock = vi.fn();
const setSyncCursorIdMock = vi.fn();

vi.mock("./sync-cursor.repository", () => ({
  getSyncCursorId: (...args: unknown[]) => getSyncCursorIdMock(...args),
  setSyncCursorId: (...args: unknown[]) => setSyncCursorIdMock(...args),
}));

const transactionGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const fakeTransaction = { get: transactionGetMock, set: vi.fn(), update: vi.fn() };
      return fn(fakeTransaction);
    },
  },
}));

function fakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    branchId: "branch-1",
    appId: "restaurant",
    status: "completed",
    totals: { subtotal: 10, tax: 0, discount: 0, total: 10 },
    createdBy: "owner-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionGetMock.mockResolvedValue({ exists: false });
});

describe("enrollMember", () => {
  it("creates the member and writes the enrollment audit atomically", async () => {
    const { enrollMember } = await import("./loyalty.service");

    const member = await enrollMember("company-1", "owner-1", { name: "Jane", contactRef: "jane@x.com" });

    expect(createMemberInTransactionMock).toHaveBeenCalled();
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "loyalty.memberEnrolled", targetType: "loyaltyMember" }),
    );
    expect(member).toEqual({ id: "new-member-id", name: "Jane", contactRef: "jane@x.com", pointsBalance: 0 });
  });
});

describe("attributeOrderToMember", () => {
  it("throws OrderNotFoundError when the order doesn't exist", async () => {
    getOrderMock.mockResolvedValue(null);
    getMemberMock.mockResolvedValue({ id: "member-1", name: "Jane", contactRef: null, pointsBalance: 0 });
    const { attributeOrderToMember } = await import("./loyalty.service");
    const { OrderNotFoundError } = await import("../domain/errors");

    await expect(attributeOrderToMember("company-1", "order-1", "member-1", "owner-1")).rejects.toThrow(
      OrderNotFoundError,
    );
  });

  it("throws MemberNotFoundError when the member doesn't exist", async () => {
    getOrderMock.mockResolvedValue(fakeOrder());
    getMemberMock.mockResolvedValue(null);
    const { attributeOrderToMember } = await import("./loyalty.service");
    const { MemberNotFoundError } = await import("../domain/errors");

    await expect(attributeOrderToMember("company-1", "order-1", "member-1", "owner-1")).rejects.toThrow(
      MemberNotFoundError,
    );
  });

  it("writes the attribution when none exists yet", async () => {
    getOrderMock.mockResolvedValue(fakeOrder());
    getMemberMock.mockResolvedValue({ id: "member-1", name: "Jane", contactRef: null, pointsBalance: 0 });
    transactionGetMock.mockResolvedValue({ exists: false });
    const { attributeOrderToMember } = await import("./loyalty.service");

    await attributeOrderToMember("company-1", "order-1", "member-1", "owner-1");

    expect(setAttributionInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      "order-1",
      "member-1",
      "owner-1",
    );
  });

  it("is idempotent when re-attributed to the same member", async () => {
    getOrderMock.mockResolvedValue(fakeOrder());
    getMemberMock.mockResolvedValue({ id: "member-1", name: "Jane", contactRef: null, pointsBalance: 0 });
    transactionGetMock.mockResolvedValue({ exists: true, data: () => ({ memberId: "member-1" }) });
    const { attributeOrderToMember } = await import("./loyalty.service");

    await expect(attributeOrderToMember("company-1", "order-1", "member-1", "owner-1")).resolves.toBeUndefined();
    expect(setAttributionInTransactionMock).not.toHaveBeenCalled();
  });

  it("throws OrderAlreadyAttributedError when attributed to a different member", async () => {
    getOrderMock.mockResolvedValue(fakeOrder());
    getMemberMock.mockResolvedValue({ id: "member-2", name: "Bob", contactRef: null, pointsBalance: 0 });
    transactionGetMock.mockResolvedValue({ exists: true, data: () => ({ memberId: "member-1" }) });
    const { attributeOrderToMember } = await import("./loyalty.service");
    const { OrderAlreadyAttributedError } = await import("../domain/errors");

    await expect(attributeOrderToMember("company-1", "order-1", "member-2", "owner-1")).rejects.toThrow(
      OrderAlreadyAttributedError,
    );
  });
});

describe("syncAccruals", () => {
  it("does nothing when the audit log is empty", async () => {
    getSyncCursorIdMock.mockResolvedValue(null);
    listAuditLogsPageMock.mockResolvedValue({ items: [], nextCursor: null });
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    expect(result).toEqual({ processedCount: 0, accruedCount: 0, skippedCount: 0 });
    expect(setSyncCursorIdMock).not.toHaveBeenCalled();
  });

  it("skips order.completed entries with no attribution, but still advances the cursor past them", async () => {
    getSyncCursorIdMock.mockResolvedValue(null);
    listAuditLogsPageMock.mockResolvedValue({
      items: [{ id: "log-1", action: "order.completed", targetId: "order-1", actorId: "owner-1", targetType: "order" }],
      nextCursor: null,
    });
    getAttributionMock.mockResolvedValue(null);
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    expect(result).toEqual({ processedCount: 1, accruedCount: 0, skippedCount: 1 });
    expect(getOrderMock).not.toHaveBeenCalled();
    expect(setSyncCursorIdMock).toHaveBeenCalledWith("company-1", "log-1");
  });

  it("ignores non-order.completed audit entries entirely", async () => {
    getSyncCursorIdMock.mockResolvedValue(null);
    listAuditLogsPageMock.mockResolvedValue({
      items: [{ id: "log-1", action: "order.created", targetId: "order-1", actorId: "owner-1", targetType: "order" }],
      nextCursor: null,
    });
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    expect(result).toEqual({ processedCount: 0, accruedCount: 0, skippedCount: 0 });
    // No order.completed entries were collected, so nothing to advance the cursor to.
    expect(setSyncCursorIdMock).not.toHaveBeenCalled();
  });

  it("accrues points for an attributed, completed order and writes the ledger + audit atomically", async () => {
    getSyncCursorIdMock.mockResolvedValue(null);
    listAuditLogsPageMock.mockResolvedValue({
      items: [{ id: "log-1", action: "order.completed", targetId: "order-1", actorId: "owner-1", targetType: "order" }],
      nextCursor: null,
    });
    getAttributionMock.mockResolvedValue({ orderId: "order-1", memberId: "member-1", attributedBy: "owner-1" });
    getLedgerEntryByOrderIdMock.mockResolvedValue(null);
    getOrderMock.mockResolvedValue(fakeOrder({ totals: { subtotal: 25, tax: 0, discount: 0, total: 25 } }));
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    expect(result).toEqual({ processedCount: 1, accruedCount: 1, skippedCount: 0 });
    expect(appendLedgerEntryInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      "company-1",
      expect.objectContaining({ memberId: "member-1", type: "earned", points: 25, orderId: "order-1" }),
    );
    expect(adjustMemberBalanceInTransactionMock).toHaveBeenCalledWith(expect.anything(), "company-1", "member-1", 25);
    expect(writeAuditInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "loyalty.pointsEarned", targetType: "loyaltyLedgerEntry" }),
    );
  });

  it("does not double-accrue when a ledger entry already exists for the order", async () => {
    getSyncCursorIdMock.mockResolvedValue(null);
    listAuditLogsPageMock.mockResolvedValue({
      items: [{ id: "log-1", action: "order.completed", targetId: "order-1", actorId: "owner-1", targetType: "order" }],
      nextCursor: null,
    });
    getAttributionMock.mockResolvedValue({ orderId: "order-1", memberId: "member-1", attributedBy: "owner-1" });
    getLedgerEntryByOrderIdMock.mockResolvedValue({
      id: "entry-1",
      memberId: "member-1",
      type: "earned",
      points: 10,
      orderId: "order-1",
      reason: null,
      actorId: "owner-1",
    });
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    expect(result).toEqual({ processedCount: 1, accruedCount: 0, skippedCount: 0 });
    expect(appendLedgerEntryInTransactionMock).not.toHaveBeenCalled();
  });

  it("skips (rather than aborting) an order outside the caller's branch access", async () => {
    getSyncCursorIdMock.mockResolvedValue(null);
    listAuditLogsPageMock.mockResolvedValue({
      // newest-first, per listAuditLogsPage's own contract -- log-2 is
      // newer than log-1, so processing order (after the service's own
      // oldest-first reversal) is order-1 first, order-2 second.
      items: [
        { id: "log-2", action: "order.completed", targetId: "order-2", actorId: "owner-1", targetType: "order" },
        { id: "log-1", action: "order.completed", targetId: "order-1", actorId: "owner-1", targetType: "order" },
      ],
      nextCursor: null,
    });
    getAttributionMock.mockResolvedValue({ orderId: "order-1", memberId: "member-1", attributedBy: "owner-1" });
    getLedgerEntryByOrderIdMock.mockResolvedValue(null);
    getOrderMock
      .mockRejectedValueOnce(new FakeBranchAccessDeniedError()) // order-1, processed first
      .mockResolvedValueOnce(fakeOrder({ id: "order-2" })); // order-2, processed second
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    expect(result.skippedCount).toBe(1);
    expect(result.accruedCount).toBe(1);
    expect(setSyncCursorIdMock).toHaveBeenCalledWith("company-1", "log-2");
  });

  it("paginates backward through multiple pages until the stored cursor is found", async () => {
    getSyncCursorIdMock.mockResolvedValue("log-1");
    listAuditLogsPageMock
      .mockResolvedValueOnce({
        items: [{ id: "log-3", action: "order.completed", targetId: "order-3", actorId: "owner-1", targetType: "order" }],
        nextCursor: "log-3",
      })
      .mockResolvedValueOnce({
        items: [
          { id: "log-2", action: "order.completed", targetId: "order-2", actorId: "owner-1", targetType: "order" },
          { id: "log-1", action: "order.completed", targetId: "order-1", actorId: "owner-1", targetType: "order" },
        ],
        nextCursor: null,
      });
    getAttributionMock.mockResolvedValue(null); // skip-only path keeps this test focused on pagination
    const { syncAccruals } = await import("./loyalty.service");

    const result = await syncAccruals("company-1");

    // log-1 (the stored cursor) must be excluded; only log-2 and log-3 are new.
    expect(result.processedCount).toBe(2);
    expect(listAuditLogsPageMock).toHaveBeenCalledTimes(2);
    expect(setSyncCursorIdMock).toHaveBeenCalledWith("company-1", "log-3");
  });
});
