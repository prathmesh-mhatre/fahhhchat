import type { Redis } from "ioredis";
import type { RateLimitStore } from "./rate-limit.types";

/**
 * Redis-backed fixed-window counters, matching the PRD decision to keep rate
 * limits in Redis so they hold across every API instance. Each key is a counter
 * that Redis expires via TTL, so an idle identity's window cleans itself up.
 *
 * The first `INCR` on an absent key returns 1; only then do we set the window's
 * TTL, so subsequent increments within the window leave the expiry untouched and
 * the window slides forward only after it elapses. The two commands run in a
 * MULTI so a crash between them cannot leave a counter without an expiry (which
 * would wedge an identity at the limit forever). The remaining TTL drives
 * `resetAtMs`, keeping reset math in lockstep with Redis's own expiry.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  private key(key: string): string {
    return `rate-limit:${key}`;
  }

  async increment(
    key: string,
    windowMs: number,
    now: number
  ): Promise<{ count: number; resetAtMs: number }> {
    const redisKey = this.key(key);
    // SET ... NX seeds the counter at 0 with the window TTL only when the key is
    // absent (a fresh window); the following INCR then counts this attempt. An
    // existing window is left with its TTL intact, so it slides only after expiry.
    const results = await this.redis
      .multi()
      .set(redisKey, 0, "PX", windowMs, "NX")
      .incr(redisKey)
      .exec();
    // exec() returns one [error, value] pair per queued command; the INCR is last.
    const count = Number(results?.[1]?.[1] ?? 0);

    // Read the live TTL so `resetAt` reflects when Redis will actually drop the
    // counter, even if another instance set the window a few ms earlier.
    const ttlMs = await this.redis.pttl(redisKey);
    const resetAtMs = ttlMs >= 0 ? now + ttlMs : now + windowMs;
    return { count, resetAtMs };
  }
}
