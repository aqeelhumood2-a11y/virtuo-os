import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: () => getMock() }),
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

describe("getCompanyLicense", () => {
  it("returns null when no license doc exists", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { getCompanyLicense } = await import("./license.repository");

    await expect(getCompanyLicense("company-1")).resolves.toBeNull();
  });

  it("maps a license doc, defaulting malformed arrays to []", async () => {
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", entitledApps: ["restaurant"], seats: 5, renewsAt: "2027-01-01" }),
    });
    const { getCompanyLicense } = await import("./license.repository");

    await expect(getCompanyLicense("company-1")).resolves.toEqual({
      plan: "pro",
      entitledApps: ["restaurant"],
      entitledConnectors: [],
      seats: 5,
      renewsAt: "2027-01-01",
    });
  });
});

describe("isAppEntitled / isConnectorEntitled", () => {
  it("returns false when there's no license doc at all (fails closed)", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { isAppEntitled, isConnectorEntitled } = await import("./license.repository");

    await expect(isAppEntitled("company-1", "restaurant")).resolves.toBe(false);
    await expect(isConnectorEntitled("company-1", "custom-api")).resolves.toBe(false);
  });

  it("returns true only when the id is in the entitled list", async () => {
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({
        plan: "pro",
        entitledApps: ["restaurant"],
        entitledConnectors: ["custom-api"],
        seats: 5,
        renewsAt: null,
      }),
    });
    const { isAppEntitled, isConnectorEntitled } = await import("./license.repository");

    await expect(isAppEntitled("company-1", "restaurant")).resolves.toBe(true);
    await expect(isAppEntitled("company-1", "retail")).resolves.toBe(false);
    await expect(isConnectorEntitled("company-1", "custom-api")).resolves.toBe(true);
    await expect(isConnectorEntitled("company-1", "shopify")).resolves.toBe(false);
  });
});
