import { Module } from "@nestjs/common";
import { InMemoryRateLimitStore } from "./in-memory-rate-limit.store";
import { RateLimitService } from "./rate-limit.service";
import { RATE_LIMIT_STORE, type RateLimitStore } from "./rate-limit.types";

/**
 * Selects the rate-limit backing store from the environment: Redis when
 * `REDIS_URL` is set (production / integration), so counters hold across every
 * API instance, otherwise an in-memory store for local dev and tests. ioredis is
 * required lazily so the in-memory path needs no Redis client, mirroring the
 * seam used by {@link import("../matchmaking/matchmaking.module")} and
 * {@link import("../session/session.module")}.
 */
function createRateLimitStore(): RateLimitStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new InMemoryRateLimitStore();
  }
  const { Redis } = require("ioredis") as typeof import("ioredis");
  const { RedisRateLimitStore } =
    require("./redis-rate-limit.store") as typeof import("./redis-rate-limit.store");
  return new RedisRateLimitStore(new Redis(redisUrl));
}

/**
 * Shared abuse-control rate limiting (issue #20, stories 140-144). Exports
 * {@link RateLimitService} so the matchmaking and realtime slices can throttle
 * queue joins and reconnect attempts without each owning its own counters.
 */
@Module({
  providers: [
    RateLimitService,
    { provide: RATE_LIMIT_STORE, useFactory: createRateLimitStore },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
