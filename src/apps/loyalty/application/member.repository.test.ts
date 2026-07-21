import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const collectionGetMock = vi.fn();
const transactionSetMock = vi.fn();
const transactionUpdateMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: docGetMock, id: "new-member-id" }),
              get: collectionGetMock,
            }),
          }),
        }),
      }),
    }),
  },
}));

function fakeMemberData(overrides: Record<string, unknown> = {}) {
  return { name: "Jane Doe", contactRef: "jane@example.com", pointsBalance: 10, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMember", () => {
  it("returns null when the doc doesn't exist", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getMember } = await import("./member.repository");

    await expect(getMember("company-1", "member-1")).resolves.toBeNull();
  });

  it("maps an existing doc, defaulting contactRef/pointsBalance", async () => {
    docGetMock.mockResolvedValue({ exists: true, id: "member-1", data: () => fakeMemberData({ contactRef: undefined, pointsBalance: undefined }) });
    const { getMember } = await import("./member.repository");

    await expect(getMember("company-1", "member-1")).resolves.toEqual({
      id: "member-1",
      name: "Jane Doe",
      contactRef: null,
      pointsBalance: 0,
    });
  });
});

describe("listMembers", () => {
  it("maps every returned doc", async () => {
    collectionGetMock.mockResolvedValue({ docs: [{ id: "member-1", data: () => fakeMemberData() }] });
    const { listMembers } = await import("./member.repository");

    const result = await listMembers("company-1");
    expect(result).toEqual([{ id: "member-1", name: "Jane Doe", contactRef: "jane@example.com", pointsBalance: 10 }]);
  });
});

describe("createMemberInTransaction", () => {
  it("sets the member doc with pointsBalance 0", async () => {
    const { createMemberInTransaction, newMemberRef } = await import("./member.repository");
    const ref = newMemberRef("company-1");
    const fakeTransaction = { set: (r: unknown, data: unknown) => transactionSetMock(data) };

    createMemberInTransaction(fakeTransaction as never, ref, { name: "Jane", contactRef: null });

    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Jane", contactRef: null, pointsBalance: 0 }),
    );
  });
});

describe("adjustMemberBalanceInTransaction", () => {
  it("uses FieldValue.increment for the delta", async () => {
    const { adjustMemberBalanceInTransaction } = await import("./member.repository");
    const fakeTransaction = { update: (r: unknown, data: unknown) => transactionUpdateMock(data) };

    adjustMemberBalanceInTransaction(fakeTransaction as never, "company-1", "member-1", 25);

    expect(transactionUpdateMock).toHaveBeenCalledWith({ pointsBalance: expect.anything() });
  });
});
