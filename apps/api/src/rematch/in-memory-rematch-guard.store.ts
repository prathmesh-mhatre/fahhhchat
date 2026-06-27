import type { RematchGuardStore } from "./rematch.types";

/**
 * Process-local rematch-prevention store. Used in development and tests when no
 * `REDIS_URL` is configured. Each identity key maps to the set of keys it must
 * not be paired with, each with its own expiry (epoch ms); a read prunes any
 * entry already past `now` so the window self-clears lazily without a sweeper.
 * State is lost on restart, which is acceptable for an ephemeral exclusion
 * window but is why production uses Redis.
 *
 * Node runs this single-threaded, so each method is naturally atomic.
 */
export class InMemoryRematchGuardStore implements RematchGuardStore {
  /** identity key → (excluded key → expiry epoch ms). */
  private readonly excluded = new Map<string, Map<string, number>>();

  async record(
    keyA: string,
    keyB: string,
    expiresAt: string,
  ): Promise<void> {
    // A user can never be excluded from themselves; guard against a corrupted
    // call rather than poisoning their own matchability.
    if (keyA === keyB) {
      return;
    }
    const expiresMs = new Date(expiresAt).getTime();
    // Stored in both directions so a single excludedKeys lookup covers "I
    // blocked them" and "they blocked me"; refreshing overwrites the old expiry.
    this.put(keyA, keyB, expiresMs);
    this.put(keyB, keyA, expiresMs);
  }

  async excludedKeys(key: string, now: Date): Promise<string[]> {
    const entries = this.excluded.get(key);
    if (!entries) {
      return [];
    }
    const nowMs = now.getTime();
    const active: string[] = [];
    for (const [other, expiresMs] of entries) {
      if (expiresMs <= nowMs) {
        // Lazily reap the lapsed exclusion so the window self-clears on read.
        entries.delete(other);
      } else {
        active.push(other);
      }
    }
    if (entries.size === 0) {
      this.excluded.delete(key);
    }
    return active;
  }

  private put(key: string, other: string, expiresMs: number): void {
    let entries = this.excluded.get(key);
    if (!entries) {
      entries = new Map<string, number>();
      this.excluded.set(key, entries);
    }
    entries.set(other, expiresMs);
  }
}
