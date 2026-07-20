import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter, checkRateLimit } from "./rate-limit";

describe("InMemoryRateLimiter", () => {
  it("allows requests up to the limit within the window", () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(limiter.consume("key", 3, 1000).allowed).toBe(true);
    }
  });

  it("denies requests once the limit is exceeded within the window", () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.consume("key", 3, 1000);
    const result = limiter.consume("key", 3, 1000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.consume("a", 3, 1000);
    expect(limiter.consume("a", 3, 1000).allowed).toBe(false);
    expect(limiter.consume("b", 3, 1000).allowed).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.consume("key", 3, 10);
    expect(limiter.consume("key", 3, 10).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(limiter.consume("key", 3, 10).allowed).toBe(true);
  });
});

describe("checkRateLimit", () => {
  it("applies the configured limit per action, keyed by identifier", () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("signIn", "a@example.com", limiter).allowed).toBe(true);
    }
    expect(checkRateLimit("signIn", "a@example.com", limiter).allowed).toBe(false);
    // A different action for the same identifier has its own budget.
    expect(checkRateLimit("signUp", "a@example.com", limiter).allowed).toBe(true);
  });
});
