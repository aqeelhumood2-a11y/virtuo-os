import { describe, expect, it } from "vitest";

import { csrfTokensMatch, generateCsrfToken } from "./csrf";

describe("csrf", () => {
  it("generates tokens that are non-empty, sufficiently long, and unique", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();

    expect(a).toHaveLength(64);
    expect(b).toHaveLength(64);
    expect(a).not.toBe(b);
  });

  it("matches identical tokens", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it("rejects mismatched tokens", () => {
    expect(csrfTokensMatch(generateCsrfToken(), generateCsrfToken())).toBe(false);
  });

  it("rejects when either side is missing", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch("", token)).toBe(false);
    expect(csrfTokensMatch(token, "")).toBe(false);
    expect(csrfTokensMatch("", "")).toBe(false);
  });

  it("rejects tokens of differing length without throwing", () => {
    expect(csrfTokensMatch("short", generateCsrfToken())).toBe(false);
  });
});
