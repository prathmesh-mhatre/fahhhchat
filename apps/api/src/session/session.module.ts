import { Module } from "@nestjs/common";
import { GuestSessionService } from "./guest-session.service";
import { GuestGuard } from "./guest.guard";
import { SafetyGuidelinesGuard } from "./safety-guidelines.guard";
import { InMemorySessionStore } from "./in-memory-session.store";
import { SessionController } from "./session.controller";
import { SESSION_STORE, SessionStore } from "./session.types";

/**
 * Selects the session store from the environment: Redis when `REDIS_URL` is set
 * (production / integration), otherwise an in-memory store for local dev and
 * tests. ioredis is imported lazily so the in-memory path needs no Redis client.
 */
function createSessionStore(): SessionStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new InMemorySessionStore();
  }
  // Lazy require keeps Redis out of the dev/test path entirely.
  const { Redis } = require("ioredis") as typeof import("ioredis");
  const { RedisSessionStore } = require("./redis-session.store") as typeof import("./redis-session.store");
  return new RedisSessionStore(new Redis(redisUrl));
}

@Module({
  controllers: [SessionController],
  providers: [
    GuestSessionService,
    GuestGuard,
    SafetyGuidelinesGuard,
    {
      provide: SESSION_STORE,
      useFactory: createSessionStore
    }
  ],
  exports: [GuestSessionService]
})
export class SessionModule {}
