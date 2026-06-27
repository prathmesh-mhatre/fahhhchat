import type { Redis } from "ioredis";
import type { RematchGuardStore } from "./rematch.types";

const KEY_PREFIX = "rematch:block:";

/**
 * Redis-backed rematch-prevention store, matching the PRD decision to keep
 * ephemeral matching/realtime state in Redis. Each identity key gets a sorted
 * set `rematch:block:{key}` whose members are the keys it must not be paired
 * with, scored by their expiry (epoch ms). A mutual exclusion is two members —
 * one in each side's set.
 *
 * Reads prune lazily with `ZREMRANGEBYSCORE (-inf, now]` so an expired exclusion
 * is never returned, and each write also stamps a `PEXPIREAT` on the set equal to
 * the newest member's expiry, so a set that is never read again still drops out
 * of Redis on its own rather than leaking keys. The window is short, so the sets
 * stay tiny.
 */
export class RedisRematchGuardStore implements RematchGuardStore {
  constructor(private readonly redis: Redis) {}

  async record(
    keyA: string,
    keyB: string,
    expiresAt: string,
  ): Promise<void> {
    if (keyA === keyB) {
      return;
    }
    const expiresMs = new Date(expiresAt).getTime();
    const setA = this.setKey(keyA);
    const setB = this.setKey(keyB);
    // Both directions in one round-trip; PEXPIREAT bounds each set's lifetime by
    // its newest member (the one just added is the latest of a fixed window), so
    // a set self-destructs once its last exclusion would have lapsed.
    await this.redis
      .multi()
      .zadd(setA, expiresMs, keyB)
      .pexpireat(setA, expiresMs)
      .zadd(setB, expiresMs, keyA)
      .pexpireat(setB, expiresMs)
      .exec();
  }

  async excludedKeys(key: string, now: Date): Promise<string[]> {
    const setKey = this.setKey(key);
    const nowMs = now.getTime();
    const [, members] = (await this.redis
      .multi()
      .zremrangebyscore(setKey, "-inf", nowMs)
      .zrange(setKey, 0, -1)
      .exec()) as Array<[Error | null, unknown]>;
    return (members?.[1] as string[] | undefined) ?? [];
  }

  private setKey(key: string): string {
    return `${KEY_PREFIX}${key}`;
  }
}
