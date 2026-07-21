import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfTokensMatchMock = vi.fn();
const requireSessionMock = vi.fn();
const setMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

let csrfCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "csrf_token" && csrfCookieValue ? { value: csrfCookieValue } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/core/auth/csrf", () => ({
  csrfTokensMatch: (...args: unknown[]) => csrfTokensMatchMock(...args),
}));

vi.mock("@/core/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: (uid: string) => ({
        set: (data: unknown, options: unknown) => setMock(uid, data, options),
      }),
    }),
  },
}));

import { updateDisplayNameAction } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  csrfCookieValue = "valid-csrf-token";
  csrfTokensMatchMock.mockReturnValue(true);
  requireSessionMock.mockResolvedValue({ uid: "uid-1", email: "a@example.com" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateDisplayNameAction", () => {
  it("rejects when the CSRF token does not match", async () => {
    csrfTokensMatchMock.mockReturnValue(false);
    const result = await updateDisplayNameAction(
      {},
      formData({ displayName: "Alice", csrfToken: "wrong" }),
    );
    expect(result.error).toMatch(/session has expired/i);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("rejects an empty display name", async () => {
    const result = await updateDisplayNameAction(
      {},
      formData({ displayName: "   ", csrfToken: "valid-csrf-token" }),
    );
    expect(result.error).toBeDefined();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("writes only displayName to the caller's own user document, then redirects", async () => {
    await expect(
      updateDisplayNameAction({}, formData({ displayName: "Alice", csrfToken: "valid-csrf-token" })),
    ).rejects.toThrow("REDIRECT:/account");

    expect(setMock).toHaveBeenCalledWith("uid-1", { displayName: "Alice" }, { merge: true });
  });
});
