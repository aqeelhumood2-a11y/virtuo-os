import { beforeEach, describe, expect, it, vi } from "vitest";

const docGetMock = vi.fn();
const transactionSetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: docGetMock, set: (...args: unknown[]) => transactionSetMock(...args) }),
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

describe("getAttribution", () => {
  it("returns null when no attribution exists", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    const { getAttribution } = await import("./attribution.repository");

    await expect(getAttribution("company-1", "order-1")).resolves.toBeNull();
  });

  it("maps an existing attribution, keyed by orderId", async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      id: "order-1",
      data: () => ({ memberId: "member-1", attributedBy: "owner-1" }),
    });
    const { getAttribution } = await import("./attribution.repository");

    await expect(getAttribution("company-1", "order-1")).resolves.toEqual({
      orderId: "order-1",
      memberId: "member-1",
      attributedBy: "owner-1",
    });
  });
});

describe("setAttributionInTransaction", () => {
  it("writes the attribution doc", async () => {
    const { setAttributionInTransaction } = await import("./attribution.repository");
    const fakeTransaction = { set: (ref: unknown, data: unknown) => transactionSetMock(data) };

    setAttributionInTransaction(fakeTransaction as never, "company-1", "order-1", "member-1", "owner-1");

    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member-1", attributedBy: "owner-1" }),
    );
  });
});
