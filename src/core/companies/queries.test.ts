import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMyCompaniesMock = vi.fn();
const companyGetMock = vi.fn();
const branchesWhereGetMock = vi.fn();

vi.mock("./membership", () => ({
  listMyCompanies: (...args: unknown[]) => listMyCompaniesMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: () => companyGetMock(),
        collection: () => ({
          where: () => ({
            limit: () => ({ get: () => branchesWhereGetMock() }),
          }),
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getMyCompanySummary", () => {
  it("returns null when the user has no active company membership", async () => {
    listMyCompaniesMock.mockResolvedValue([]);
    const { getMyCompanySummary } = await import("./queries");

    await expect(getMyCompanySummary("uid-1")).resolves.toBeNull();
    expect(companyGetMock).not.toHaveBeenCalled();
  });

  it("resolves the company name and default branch name for the first membership", async () => {
    listMyCompaniesMock.mockResolvedValue([{ companyId: "company-1", role: "Owner" }]);
    companyGetMock.mockResolvedValue({ exists: true, data: () => ({ name: "Acme" }) });
    branchesWhereGetMock.mockResolvedValue({ empty: false, docs: [{ data: () => ({ name: "Main" }) }] });
    const { getMyCompanySummary } = await import("./queries");

    await expect(getMyCompanySummary("uid-1")).resolves.toEqual({
      companyId: "company-1",
      companyName: "Acme",
      role: "Owner",
      branchName: "Main",
    });
  });

  it("falls back to the companyId when the company doc doesn't exist", async () => {
    listMyCompaniesMock.mockResolvedValue([{ companyId: "company-1", role: "Owner" }]);
    companyGetMock.mockResolvedValue({ exists: false });
    branchesWhereGetMock.mockResolvedValue({ empty: true, docs: [] });
    const { getMyCompanySummary } = await import("./queries");

    await expect(getMyCompanySummary("uid-1")).resolves.toEqual({
      companyId: "company-1",
      companyName: "company-1",
      role: "Owner",
      branchName: null,
    });
  });

  it("returns branchName: null when no default branch exists yet", async () => {
    listMyCompaniesMock.mockResolvedValue([{ companyId: "company-1", role: "Manager" }]);
    companyGetMock.mockResolvedValue({ exists: true, data: () => ({ name: "Acme" }) });
    branchesWhereGetMock.mockResolvedValue({ empty: true, docs: [] });
    const { getMyCompanySummary } = await import("./queries");

    const result = await getMyCompanySummary("uid-1");
    expect(result?.branchName).toBeNull();
  });
});
