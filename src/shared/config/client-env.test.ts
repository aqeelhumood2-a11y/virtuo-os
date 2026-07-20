import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "test-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "test-project",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "test.firebasestorage.app",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:abc123",
};

// This module is never statically imported: its top-level `export const
// clientEnv = parseClientEnv(process.env)` runs the instant the module is
// evaluated, so each test stubs process.env first, resets Vitest's module
// registry, and only then dynamically imports — never touching the real
// .env.local.
describe("client-env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses successfully when all required variables are present", async () => {
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
    vi.resetModules();
    const { clientEnv } = await import("./client-env");
    expect(clientEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe(
      validEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    );
  });

  it("throws a clear, value-free error when required variables are missing", async () => {
    for (const key of Object.keys(validEnv)) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();

    await expect(import("./client-env")).rejects.toThrow(
      /Invalid or missing client environment variables/,
    );
  });

  it("names the missing keys without echoing any value", async () => {
    for (const key of Object.keys(validEnv)) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();

    try {
      await import("./client-env");
      throw new Error("expected import of ./client-env to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("NEXT_PUBLIC_FIREBASE_API_KEY");
      expect(message).not.toContain(validEnv.NEXT_PUBLIC_FIREBASE_API_KEY);
    }
  });
});
