import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const updateMock = vi.fn();
const membersWhereGetMock = vi.fn();
const collectionGroupGetMock = vi.fn();
const requireSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: () => getMock(),
            update: (...args: unknown[]) => updateMock(...args),
          }),
          where: () => ({
            get: () => membersWhereGetMock(),
          }),
        }),
      }),
    }),
    collectionGroup: () => ({
      where: () => ({
        where: () => ({
          get: () => collectionGroupGetMock(),
        }),
      }),
    }),
  },
}));

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

function fakeDocSnapshot(exists: boolean, data?: Record<string, unknown>) {
  return { exists, data: () => data };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getMembership", () => {
  it("returns null when the membership document does not exist", async () => {
    getMock.mockResolvedValue(fakeDocSnapshot(false));
    const { getMembership } = await import("./membership");

    await expect(getMembership("company-1", "uid-1")).resolves.toBeNull();
  });

  it("returns null when the membership status is not active", async () => {
    getMock.mockResolvedValue(
      fakeDocSnapshot(true, { uid: "uid-1", role: "Owner", branchIds: [], status: "disabled" }),
    );
    const { getMembership } = await import("./membership");

    await expect(getMembership("company-1", "uid-1")).resolves.toBeNull();
  });

  it("returns the membership when active", async () => {
    getMock.mockResolvedValue(
      fakeDocSnapshot(true, { uid: "uid-1", role: "Owner", branchIds: ["branch-1"], status: "active" }),
    );
    const { getMembership } = await import("./membership");

    await expect(getMembership("company-1", "uid-1")).resolves.toEqual({
      uid: "uid-1",
      role: "Owner",
      branchIds: ["branch-1"],
      status: "active",
    });
  });

  it("defaults branchIds to an empty array if malformed", async () => {
    getMock.mockResolvedValue(
      fakeDocSnapshot(true, { uid: "uid-1", role: "Owner", status: "active" }),
    );
    const { getMembership } = await import("./membership");

    const result = await getMembership("company-1", "uid-1");
    expect(result?.branchIds).toEqual([]);
  });
});

describe("requireCompanyMembership", () => {
  it("redirects to /account when the caller has no membership in this company", async () => {
    requireSessionMock.mockResolvedValue({ uid: "uid-1", email: "a@example.com" });
    getMock.mockResolvedValue(fakeDocSnapshot(false));
    const { requireCompanyMembership } = await import("./membership");

    await expect(requireCompanyMembership("company-1")).rejects.toThrow("REDIRECT:/account");
  });

  it("returns the session and membership when the caller is an active member", async () => {
    requireSessionMock.mockResolvedValue({ uid: "uid-1", email: "a@example.com" });
    getMock.mockResolvedValue(
      fakeDocSnapshot(true, { uid: "uid-1", role: "Owner", branchIds: [], status: "active" }),
    );
    const { requireCompanyMembership } = await import("./membership");

    await expect(requireCompanyMembership("company-1")).resolves.toEqual({
      session: { uid: "uid-1", email: "a@example.com" },
      membership: { uid: "uid-1", role: "Owner", branchIds: [], status: "active" },
    });
  });
});

describe("hasBranchAccess", () => {
  it("grants access to any branch when branchIds is empty", async () => {
    const { hasBranchAccess } = await import("./membership");
    expect(hasBranchAccess({ branchIds: [] }, "any-branch")).toBe(true);
  });

  it("grants access only to listed branches when branchIds is non-empty", async () => {
    const { hasBranchAccess } = await import("./membership");
    expect(hasBranchAccess({ branchIds: ["branch-1"] }, "branch-1")).toBe(true);
    expect(hasBranchAccess({ branchIds: ["branch-1"] }, "branch-2")).toBe(false);
  });
});

describe("listMyCompanies", () => {
  it("maps collection-group query results to company/role pairs", async () => {
    collectionGroupGetMock.mockResolvedValue({
      docs: [
        {
          ref: { parent: { parent: { id: "company-1" } } },
          data: () => ({ role: "Owner" }),
        },
      ],
    });
    const { listMyCompanies } = await import("./membership");

    await expect(listMyCompanies("uid-1")).resolves.toEqual([{ companyId: "company-1", role: "Owner" }]);
  });

  it("returns an empty list when there are no memberships", async () => {
    collectionGroupGetMock.mockResolvedValue({ docs: [] });
    const { listMyCompanies } = await import("./membership");

    await expect(listMyCompanies("uid-1")).resolves.toEqual([]);
  });
});

function fakeQuerySnapshot(docs: Record<string, unknown>[]) {
  return { docs: docs.map((data) => ({ data: () => data })) };
}

describe("listCompanyMembers", () => {
  it("maps active memberships, defaulting a malformed branchIds to []", async () => {
    membersWhereGetMock.mockResolvedValue(
      fakeQuerySnapshot([
        { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
        { uid: "manager-1", role: "Manager", status: "active" },
      ]),
    );
    const { listCompanyMembers } = await import("./membership");

    await expect(listCompanyMembers("company-1")).resolves.toEqual([
      { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
      { uid: "manager-1", role: "Manager", branchIds: [], status: "active" },
    ]);
  });
});

describe("isLastActiveOwner", () => {
  it("returns false when the target is not an Owner", async () => {
    getMock.mockResolvedValue(fakeDocSnapshot(true, { uid: "manager-1", role: "Manager", branchIds: [], status: "active" }));
    const { isLastActiveOwner } = await import("./membership");

    await expect(isLastActiveOwner("company-1", "manager-1")).resolves.toBe(false);
  });

  it("returns false when the target is not found", async () => {
    getMock.mockResolvedValue(fakeDocSnapshot(false));
    const { isLastActiveOwner } = await import("./membership");

    await expect(isLastActiveOwner("company-1", "ghost-uid")).resolves.toBe(false);
  });

  it("returns true when the target is the only active Owner", async () => {
    getMock.mockResolvedValue(fakeDocSnapshot(true, { uid: "owner-1", role: "Owner", branchIds: [], status: "active" }));
    membersWhereGetMock.mockResolvedValue(
      fakeQuerySnapshot([{ uid: "owner-1", role: "Owner", branchIds: [], status: "active" }]),
    );
    const { isLastActiveOwner } = await import("./membership");

    await expect(isLastActiveOwner("company-1", "owner-1")).resolves.toBe(true);
  });

  it("returns false when another active Owner exists", async () => {
    getMock.mockResolvedValue(fakeDocSnapshot(true, { uid: "owner-1", role: "Owner", branchIds: [], status: "active" }));
    membersWhereGetMock.mockResolvedValue(
      fakeQuerySnapshot([
        { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
        { uid: "owner-2", role: "Owner", branchIds: [], status: "active" },
      ]),
    );
    const { isLastActiveOwner } = await import("./membership");

    await expect(isLastActiveOwner("company-1", "owner-1")).resolves.toBe(false);
  });
});

describe("updateMembershipRole", () => {
  it("updates only the role field on the target membership doc", async () => {
    const { updateMembershipRole } = await import("./membership");
    await updateMembershipRole("company-1", "uid-1", "Manager");

    expect(updateMock).toHaveBeenCalledWith({ role: "Manager" });
  });
});

describe("deactivateMembership", () => {
  it("sets status to disabled on the target membership doc", async () => {
    const { deactivateMembership } = await import("./membership");
    await deactivateMembership("company-1", "uid-1");

    expect(updateMock).toHaveBeenCalledWith({ status: "disabled" });
  });
});
