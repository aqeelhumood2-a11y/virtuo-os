import "server-only";

import { RATE_LIMITS } from "./constants";

export type RateLimitResult = { allowed: boolean; retryAfterMs?: number };

// Abstraction boundary: call sites depend only on this interface, never on
// the concrete in-memory implementation below. A distributed backing store
// (Redis/Upstash/Firestore) can be swapped in later by providing a
// different RateLimiter to `checkRateLimit` -- no call site changes.
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): RateLimitResult;
}

// Basic, single-process, in-memory fixed-window limiter. This is Phase 1B's
// explicitly "basic" implementation: it resets on every server restart and
// does not coordinate across multiple server instances/serverless
// invocations. It exists as a first line of defense in front of Firebase's
// own native throttling (TOO_MANY_ATTEMPTS_TRY_LATER), not a replacement
// for it.
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (entry.count >= limit) {
      return { allowed: false, retryAfterMs: windowMs - (now - entry.windowStart) };
    }

    entry.count += 1;
    return { allowed: true };
  }
}

const defaultLimiter: RateLimiter = new InMemoryRateLimiter();

export function checkRateLimit(
  action: keyof typeof RATE_LIMITS,
  identifier: string,
  limiter: RateLimiter = defaultLimiter,
): RateLimitResult {
  const { limit, windowMs } = RATE_LIMITS[action];
  return limiter.consume(`${action}:${identifier}`, limit, windowMs);
}
