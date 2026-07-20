import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: () => getMock(),
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

describe("getUserProfile", () => {
  it("returns null when the user document does not exist", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });
    const { getUserProfile } = await import("./profile");

    await expect(getUserProfile("uid-1")).resolves.toBeNull();
  });

  it("returns the profile with defaults for missing optional fields", async () => {
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ uid: "uid-1", email: "a@example.com", status: "active" }),
    });
    const { getUserProfile } = await import("./profile");

    await expect(getUserProfile("uid-1")).resolves.toEqual({
      uid: "uid-1",
      email: "a@example.com",
      displayName: null,
      photoURL: null,
      status: "active",
    });
  });
});
