import {
  genderFilterSatisfiedBy,
  type MatchCriteria,
  type MatchmakingQueue,
  type QueuedParticipant,
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
    const { excludeKey, now } = criteria;
    // The Map iterates in insertion order, i.e. oldest-first, so the first
    // candidate found in each tier is the longest-waiting one (no starvation).
    let fallback: { key: string; participant: QueuedParticipant } | null = null;
    for (const [key, participant] of this.waiting) {
      if (key === excludeKey) {
        continue;
      }

      const waited = now - participant.enqueuedAt;
      const sameLanguage = participant.language === criteria.language;
      const languageOk = sameLanguage || waited >= criteria.relaxAfterMs;

      // The joiner's filter (full strength — they just arrived) must accept the
      // waiter's declared gender; the waiter's own filter must accept the joiner
      // *or* have relaxed past its window. Both pass automatically when filtering
      // is off (kill switch), so the pool behaves as if no one filtered.
      const joinerAcceptsWaiter =
        !criteria.genderFilteringEnabled ||
        genderFilterSatisfiedBy(criteria.genderFilter, participant.gender);
      const waiterFilterMet =
        !criteria.genderFilteringEnabled ||
        genderFilterSatisfiedBy(participant.genderFilter, criteria.gender);
      const waiterAcceptsJoiner =
        waiterFilterMet || waited >= criteria.genderRelaxAfterMs;
      const genderOk = joinerAcceptsWaiter && waiterAcceptsJoiner;

      if (!languageOk || !genderOk) {
        continue;
      }

      // Ideal: same language and both filters met with no relaxation on either
      // axis. Oldest-first means the first ideal waiter is the oldest, so take it.
      if (sameLanguage && joinerAcceptsWaiter && waiterFilterMet) {
        this.waiting.delete(key);
        return participant;
      }
      // Otherwise remember the oldest acceptable (but relaxed) waiter, used only
      // if no ideal partner turns up in this scan.
      if (fallback === null) {
        fallback = { key, participant };
      }
    }
    if (fallback) {
      this.waiting.delete(fallback.key);
      return fallback.participant;
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
