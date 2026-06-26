import type {
  MatchCriteria,
  MatchmakingQueue,
  QueuedParticipant,
} from "./matchmaking.types";

/**
 * Process-local matching pool. Used in development and tests when no `REDIS_URL`
 * is configured. A `Map` keyed by identity preserves insertion order (so
 * iteration is oldest-first / FIFO) and guarantees one slot per identity. State
 * is lost on restart, which is acceptable for an ephemeral queue but is why
 * production uses Redis.
 *
 * Node runs this single-threaded, so each method is naturally atomic — there is
 * no interleaving between the read and write of `takeMatch`.
 */
export class InMemoryMatchmakingQueue implements MatchmakingQueue {
  private readonly waiting = new Map<string, QueuedParticipant>();

  async enqueue(participant: QueuedParticipant): Promise<boolean> {
    const key = this.keyOf(participant);
    const isNew = !this.waiting.has(key);
    // Re-inserting moves the entry to the tail; delete first so a replaced
    // reconnect doesn't keep its old (now misleading) queue position.
    this.waiting.delete(key);
    this.waiting.set(key, participant);
    return isNew;
  }

  async remove(key: string): Promise<boolean> {
    return this.waiting.delete(key);
  }

  async contains(key: string): Promise<boolean> {
    return this.waiting.has(key);
  }

  async takeMatch(criteria: MatchCriteria): Promise<QueuedParticipant | null> {
    const { excludeKey, language, now, relaxAfterMs } = criteria;
    // The Map iterates in insertion order, i.e. oldest-first, so the first
    // candidate found in each tier is the longest-waiting one (no starvation).
    let relaxed: { key: string; participant: QueuedParticipant } | null = null;
    for (const [key, participant] of this.waiting) {
      if (key === excludeKey) {
        continue;
      }
      // Same-language is the preferred tier; take the oldest such waiter at once.
      if (participant.language === language) {
        this.waiting.delete(key);
        return participant;
      }
      // Otherwise remember the oldest cross-language waiter past the relaxation
      // window, used only if no same-language partner turns up in this scan.
      if (relaxed === null && now - participant.enqueuedAt >= relaxAfterMs) {
        relaxed = { key, participant };
      }
    }
    if (relaxed) {
      this.waiting.delete(relaxed.key);
      return relaxed.participant;
    }
    return null;
  }

  async removeBySocket(socketId: string): Promise<string | null> {
    for (const [key, participant] of this.waiting) {
      if (participant.socketId === socketId) {
        this.waiting.delete(key);
        return key;
      }
    }
    return null;
  }

  async size(): Promise<number> {
    return this.waiting.size;
  }

  private keyOf(participant: QueuedParticipant): string {
    return `${participant.identity.kind}:${participant.identity.id}`;
  }
}
