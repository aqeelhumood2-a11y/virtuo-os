import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  FIREBASE_PROJECT_ID: "test-project",
  FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@test-project.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
};

// Same rationale as client-env.test.ts: never statically import this
// module. `server-env.ts` also starts with `import "server-only"`, which
// vitest.config.mts aliases to a no-op stub for the test runner only.
describe("server-env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses successfully when all required variables are present", async () => {
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
    vi.resetModules();
    const { serverEnv } = await import("./server-env");
    expect(serverEnv.FIREBASE_PROJECT_ID).toBe(validEnv.FIREBASE_PROJECT_ID);
  });

  it("throws a clear, value-free error when required variables are missing", async () => {
    for (const key of Object.keys(validEnv)) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();

    await expect(import("./server-env")).rejects.toThrow(
      /Invalid or missing server environment variables/,
    );
  });

  it("names the missing keys without echoing any value", async () => {
    for (const key of Object.keys(validEnv)) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();

    try {
      await import("./server-env");
      throw new Error("expected import of ./server-env to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("FIREBASE_PRIVATE_KEY");
      expect(message).not.toContain(validEnv.FIREBASE_PRIVATE_KEY);
    }
  });
});
