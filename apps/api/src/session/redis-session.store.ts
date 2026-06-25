import type { Redis } from "ioredis";
import { GuestSessionRecord, GUEST_SESSION_TTL_SECONDS, SessionStore } from "./session.types";

/**
 * Redis-backed guest session store, matching the PRD decision to keep sessions
 * in Redis. Records expire via Redis key TTL so guest sessions stay ephemeral.
 */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = GUEST_SESSION_TTL_SECONDS
  ) {}

  private key(sessionId: string): string {
    return `guest-session:${sessionId}`;
  }

  async save(record: GuestSessionRecord): Promise<void> {
    await this.redis.set(this.key(record.sessionId), JSON.stringify(record), "EX", this.ttlSeconds);
  }

  async get(sessionId: string): Promise<GuestSessionRecord | null> {
    const raw = await this.redis.get(this.key(sessionId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as GuestSessionRecord;
  }
}
