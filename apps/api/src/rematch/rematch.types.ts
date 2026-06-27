/**
 * Persistence contract for the rematch-prevention guard (issue #27, stories
 * 53-54). When a user reports-with-block or blocks the stranger they were matched
 * with, the two identities must not be paired again *right away*; this store
 * remembers those short-lived exclusions so the matching pool can skip them.
 *
 * The exclusion is **mutual**: blocking is symmetric (neither side should meet
 * the other), so {@link RematchGuardStore.record} stores the pair in *both*
 * directions. That keeps the read side a single lookup — at join time the pool
 * asks {@link RematchGuardStore.excludedKeys} for everyone the joiner must avoid
 * and gets both "people I blocked" and "people who blocked me" in one list,
 * regardless of who joins the queue first.
 *
 * Entries are recency-bounded, not durable: each carries an expiry
 * ({@link productConfig.rematchPreventionSeconds} from when it was recorded) and
 * a read prunes anything already past it. The PRD keeps ephemeral
 * matching/realtime state in Redis, so production wires a Redis implementation;
 * an in-memory implementation keeps the slice demoable and unit-testable without
 * Redis — the same store seam used by sessions, rate limits, the matching queue,
 * and active-match chat.
 */
export interface RematchGuardStore {
  /**
   * Record a mutual rematch exclusion between two identity keys until
   * {@link expiresAt} (ISO 8601). Stored in both directions so a later
   * {@link excludedKeys} for either side returns the other. Recording the same
   * pair again refreshes the window (e.g. a second safety action) rather than
   * stacking entries. A key is the same `kind:id` identity key the matching pool
   * and chat layer use, so no identity translation is needed across seams.
   */
  record(keyA: string, keyB: string, expiresAt: string): Promise<void>;
  /**
   * The identity keys {@link key} must not be paired with as of {@link now} —
   * every still-unexpired exclusion involving them, in either direction. Expired
   * entries are pruned (never returned) so the window self-clears without a
   * separate sweeper. Returns an empty array when the identity has no active
   * exclusions, which is the common case.
   */
  excludedKeys(key: string, now: Date): Promise<string[]>;
}

export const REMATCH_GUARD_STORE = Symbol("REMATCH_GUARD_STORE");
