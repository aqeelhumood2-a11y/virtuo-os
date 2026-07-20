import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
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
