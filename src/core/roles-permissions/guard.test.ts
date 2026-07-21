import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCompanyMembershipMock = vi.fn();
const requireSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/core/companies/membership", () => ({
  requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
}));

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hasCapability", () => {
  it("returns true when the role's matrix entry includes the capability", async () => {
    const { hasCapability } = await import("./guard");
    expect(hasCapability("Owner", "membership.updateRole")).toBe(true);
    expect(hasCapability("Employee", "company.view")).toBe(true);
  });

  it("returns false when the role's matrix entry does not include the capability", async () => {
    const { hasCapability } = await import("./guard");
    expect(hasCapability("Manager", "membership.updateRole")).toBe(false);
    expect(hasCapability("Employee", "membership.deactivate")).toBe(false);
  });
});

describe("isSuperAdmin", () => {
  it("returns true only when superAdmin is exactly true", async () => {
    const { isSuperAdmin } = await import("./guard");
    expect(isSuperAdmin({ superAdmin: true })).toBe(true);
    expect(isSuperAdmin({ superAdmin: false })).toBe(false);
  });
});

describe("requireCapability", () => {
  it("returns the membership context when the role has the capability", async () => {
    const context = {
      session: { uid: "uid-1", email: "a@example.com", superAdmin: false },
      membership: { uid: "uid-1", role: "Owner", branchIds: [], status: "active" },
    };
    requireCompanyMembershipMock.mockResolvedValue(context);
    const { requireCapability } = await import("./guard");

    await expect(requireCapability("company-1", "membership.updateRole")).resolves.toEqual(context);
  });

  it("redirects to /account when the role lacks the capability", async () => {
    requireCompanyMembershipMock.mockResolvedValue({
      session: { uid: "uid-2", email: null, superAdmin: false },
      membership: { uid: "uid-2", role: "Employee", branchIds: [], status: "active" },
    });
    const { requireCapability } = await import("./guard");

    await expect(requireCapability("company-1", "membership.updateRole")).rejects.toThrow(
      "REDIRECT:/account",
    );
  });
});

describe("requireSuperAdmin", () => {
  it("returns the session when the superAdmin claim is true", async () => {
    const session = { uid: "admin-1", email: "admin@example.com", superAdmin: true };
    requireSessionMock.mockResolvedValue(session);
    const { requireSuperAdmin } = await import("./guard");

    await expect(requireSuperAdmin()).resolves.toEqual(session);
  });

  it("redirects to /account when the caller is authenticated but not a Super Admin", async () => {
    requireSessionMock.mockResolvedValue({ uid: "uid-1", email: null, superAdmin: false });
    const { requireSuperAdmin } = await import("./guard");

    await expect(requireSuperAdmin()).rejects.toThrow("REDIRECT:/account");
  });

  it("propagates requireSession's own redirect-to-/login for an unauthenticated caller", async () => {
    requireSessionMock.mockImplementation(() => {
      throw new Error("REDIRECT:/login");
    });
    const { requireSuperAdmin } = await import("./guard");

    await expect(requireSuperAdmin()).rejects.toThrow("REDIRECT:/login");
  });
});
