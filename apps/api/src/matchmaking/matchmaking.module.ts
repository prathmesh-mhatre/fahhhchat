import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import { MatchmakingController } from "./matchmaking.controller";
import { MatchmakingGateway } from "./matchmaking.gateway";
import { MatchmakingService } from "./matchmaking.service";
import { MATCHMAKING_QUEUE, type MatchmakingQueue } from "./matchmaking.types";

/**
 * Selects the matching pool from the environment: Redis when `REDIS_URL` is set
 * (production / integration), otherwise an in-memory pool for local dev and
 * tests. ioredis is required lazily so the in-memory path needs no Redis client,
 * mirroring the seam used by {@link import("../session/session.module")}.
 */
function createMatchmakingQueue(): MatchmakingQueue {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new InMemoryMatchmakingQueue();
  }
  const { Redis } = require("ioredis") as typeof import("ioredis");
  const { RedisMatchmakingQueue } =
    require("./redis-matchmaking.queue") as typeof import("./redis-matchmaking.queue");
  return new RedisMatchmakingQueue(new Redis(redisUrl));
}

/**
 * The shared global matching pool (issue #17). Imports {@link FeatureFlagsModule}
 * so queue entry and gender filtering can be gated on the `queue_entry` /
 * `gender_filters` kill switches (story 84), and {@link AuthModule} so the
 * gateway can read a logged-in joiner's declared gender + filter for gender
 * matching (stories 30-32, issue #19). Imports {@link RateLimitModule} so queue
 * joins are throttled per identity, stricter for guests (stories 142-144, issue
 * #20). The gateway shares the Socket.IO server stood up by the realtime slice;
 * no extra wiring is needed because Nest attaches every gateway on the same port
 * to one server.
 */
@Module({
  imports: [FeatureFlagsModule, AuthModule, RateLimitModule],
  controllers: [MatchmakingController],
  providers: [
    MatchmakingService,
    MatchmakingGateway,
    { provide: MATCHMAKING_QUEUE, useFactory: createMatchmakingQueue },
  ],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
