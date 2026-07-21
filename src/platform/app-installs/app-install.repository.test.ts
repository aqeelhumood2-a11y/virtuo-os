import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const whereGetMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: () => getMock() }),
          where: () => ({ get: () => whereGetMock() }),
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

describe("isAppInstalled", () => {
  it("returns false when the doc doesn't exist", async () => {
    getMock.mockResolvedValue({ exists: false });
    const { isAppInstalled } = await import("./app-install.repository");

    await expect(isAppInstalled("company-1", "restaurant")).resolves.toBe(false);
  });

  it("returns false when enabled is not exactly true", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ enabled: false }) });
    const { isAppInstalled } = await import("./app-install.repository");

    await expect(isAppInstalled("company-1", "restaurant")).resolves.toBe(false);
  });

  it("returns true when enabled is true", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ enabled: true }) });
    const { isAppInstalled } = await import("./app-install.repository");

    await expect(isAppInstalled("company-1", "restaurant")).resolves.toBe(true);
  });
});

describe("listInstalledApps", () => {
  it("maps only currently-enabled docs (the where clause does the filtering)", async () => {
    whereGetMock.mockResolvedValue({
      docs: [{ id: "restaurant", data: () => ({ enabled: true, installedAt: "2026-01-01" }) }],
    });
    const { listInstalledApps } = await import("./app-install.repository");

    await expect(listInstalledApps("company-1")).resolves.toEqual([
      { appId: "restaurant", enabled: true, installedAt: "2026-01-01", config: undefined },
    ]);
  });

  it("returns an empty list when nothing is installed", async () => {
    whereGetMock.mockResolvedValue({ docs: [] });
    const { listInstalledApps } = await import("./app-install.repository");

    await expect(listInstalledApps("company-1")).resolves.toEqual([]);
  });
});
