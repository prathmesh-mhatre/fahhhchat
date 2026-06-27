import { Module } from "@nestjs/common";
import { InMemoryRematchGuardStore } from "./in-memory-rematch-guard.store";
import { RematchGuardService } from "./rematch-guard.service";
import { REMATCH_GUARD_STORE, type RematchGuardStore } from "./rematch.types";

/**
 * Selects the rematch-prevention store from the environment: Redis when
 * `REDIS_URL` is set (production / integration), otherwise an in-memory store for
 * local dev and tests. ioredis is required lazily so the in-memory path needs no
 * Redis client, mirroring the seam used by sessions, rate limits, the matching
 * queue, and active-match chat.
 */
function createRematchGuardStore(): RematchGuardStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new InMemoryRematchGuardStore();
  }
  const { Redis } = require("ioredis") as typeof import("ioredis");
  const { RedisRematchGuardStore } =
    require("./redis-rematch-guard.store") as typeof import("./redis-rematch-guard.store");
  return new RedisRematchGuardStore(new Redis(redisUrl));
}

/**
 * The rematch-prevention guard (issue #27, stories 53-54). Owns the
 * {@link RematchGuardService} over a Redis/in-memory store seam and exports it so
 * both the chat layer (which records a block when a user reports-with-block or
 * blocks) and the matchmaking pool (which skips excluded strangers at join time)
 * can share one source of truth. Depends on nothing else, so it imports cleanly
 * into both modules without a dependency cycle.
 */
@Module({
  providers: [
    RematchGuardService,
    { provide: REMATCH_GUARD_STORE, useFactory: createRematchGuardStore },
  ],
  exports: [RematchGuardService],
})
export class RematchModule {}
