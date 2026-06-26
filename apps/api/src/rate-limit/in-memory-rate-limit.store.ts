import type { RateLimitStore } from "./rate-limit.types";

/**
 * Process-local fixed-window counters. Used in development and tests when no
 * `REDIS_URL` is configured; production uses {@link
 * import("./redis-rate-limit.store").RedisRateLimitStore} so limits hold across
 * the multiple API instances behind a load balancer. State is lost on restart,
 * which only resets counters early — acceptable for an abuse control.
 *
 * Node runs this single-threaded, so the read-modify-write below is naturally
 * atomic. Expired windows are pruned lazily on access; a key that is never hit
 * again simply lingers until the next sweep, which is fine for the bounded set
 * of active identities an MVP sees.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAtMs: number }>();

  async increment(
    key: string,
    windowMs: number,
    now: number
  ): Promise<{ count: number; resetAtMs: number }> {
    const existing = this.windows.get(key);
    // Start a fresh window when there is none or the previous one has elapsed;
    // an elapsed window is treated as a clean slate so counts never carry over.
    if (!existing || now >= existing.resetAtMs) {
      const fresh = { count: 1, resetAtMs: now + windowMs };
      this.windows.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }
}
