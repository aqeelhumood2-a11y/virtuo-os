import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCompanyMembershipMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/core/companies/membership", () => ({
  requireCompanyMembership: (...args: unknown[]) => requireCompanyMembershipMock(...args),
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

describe("hasPlatformCapability", () => {
  it("grants Owner every platform capability", async () => {
    const { hasPlatformCapability } = await import("./require-platform-capability");
    expect(hasPlatformCapability("Owner", "apps.install")).toBe(true);
    expect(hasPlatformCapability("Owner", "connectors.manage")).toBe(true);
    expect(hasPlatformCapability("Owner", "licenses.view")).toBe(true);
  });

  it("grants Manager view-only capabilities but not apps.install/connectors.manage", async () => {
    const { hasPlatformCapability } = await import("./require-platform-capability");
    expect(hasPlatformCapability("Manager", "apps.view")).toBe(true);
    expect(hasPlatformCapability("Manager", "connectors.view")).toBe(true);
    expect(hasPlatformCapability("Manager", "licenses.view")).toBe(true);
    expect(hasPlatformCapability("Manager", "apps.install")).toBe(false);
    expect(hasPlatformCapability("Manager", "connectors.manage")).toBe(false);
  });

  it("grants Supervisor and Employee nothing", async () => {
    const { hasPlatformCapability } = await import("./require-platform-capability");
    expect(hasPlatformCapability("Supervisor", "apps.view")).toBe(false);
    expect(hasPlatformCapability("Employee", "licenses.view")).toBe(false);
  });
});

describe("requirePlatformCapability", () => {
  it("returns the membership context when the role has the capability", async () => {
    const context = {
      session: { uid: "owner-1", email: null, superAdmin: false },
      membership: { uid: "owner-1", role: "Owner", branchIds: [], status: "active" },
    };
    requireCompanyMembershipMock.mockResolvedValue(context);
    const { requirePlatformCapability } = await import("./require-platform-capability");

    await expect(requirePlatformCapability("company-1", "apps.install")).resolves.toEqual(context);
  });

  it("redirects to /account when the role lacks the capability", async () => {
    requireCompanyMembershipMock.mockResolvedValue({
      session: { uid: "uid-1", email: null, superAdmin: false },
      membership: { uid: "uid-1", role: "Employee", branchIds: [], status: "active" },
    });
    const { requirePlatformCapability } = await import("./require-platform-capability");

    await expect(requirePlatformCapability("company-1", "apps.install")).rejects.toThrow("REDIRECT:/account");
  });
});
