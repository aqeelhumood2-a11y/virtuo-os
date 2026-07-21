import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCapabilityMock = vi.fn();
const branchesGetMock = vi.fn();

vi.mock("@/core/roles-permissions", () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({ get: branchesGetMock }),
      }),
    }),
  },
}));

function fakeQuerySnapshot(docs: { id: string; data: Record<string, unknown> }[]) {
  return { docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCapabilityMock.mockResolvedValue({
    session: { uid: "owner-1", email: null, superAdmin: false },
    membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
  });
});

describe("listBranches", () => {
  it("requires branch.view", async () => {
    branchesGetMock.mockResolvedValue(fakeQuerySnapshot([]));
    const { listBranches } = await import("./branches");

    await listBranches("company-1");

    expect(requireCapabilityMock).toHaveBeenCalledWith("company-1", "branch.view");
  });

  it("maps every branch document", async () => {
    branchesGetMock.mockResolvedValue(
      fakeQuerySnapshot([{ id: "branch-1", data: { name: "Main", isActive: true, isDefault: true } }]),
    );
    const { listBranches } = await import("./branches");

    const result = await listBranches("company-1");

    expect(result).toEqual([{ id: "branch-1", name: "Main", isActive: true, isDefault: true }]);
  });
});
