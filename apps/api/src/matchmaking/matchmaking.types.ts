import type {
  GenderFilter,
  LanguageCode,
  UserGender,
} from "@fahhhchat/config";
import type { RealtimeIdentity } from "../realtime/realtime.types";

/**
 * A single user waiting in the shared matching pool. The PRD uses *one* global
 * pool for both guests and logged-in users (stories 24-25, "one shared matching
 * pool"), so a participant is their realtime {@link RealtimeIdentity}, the socket
 * to reach them on, when they joined, and their soft matching preferences.
 * Language and gender are both *soft* signals the pool prefers initially and
 * relaxes over time (stories 31-33, 36), each on its own relaxation timer.
 */
export interface QueuedParticipant {
  identity: RealtimeIdentity;
  /** Socket.IO id to deliver the match notification to. */
  socketId: string;
  /** Epoch ms the participant entered the queue; drives oldest-first pairing. */
  enqueuedAt: number;
  /**
   * The user's matching language (stories 26-28), seeded from their browser
   * language and normalized to a supported {@link LanguageCode}. Used only to
   * *prefer* a same-language partner — never a hard filter, so a user is always
   * matchable across languages once the relaxation window passes.
   */
  language: LanguageCode;
  /**
   * The user's self-declared gender (story 29), or null when unknown — every
   * guest (guests never declare gender) and any logged-in user who hasn't set
   * one. This is what *other* users filter on, so it is the server-side declared
   * value, never client-asserted. `prefer_not_to_say` is a real declared value
   * but, like null, satisfies no Male/Female filter.
   */
  gender: UserGender | null;
  /**
   * The user's own gender filter (story 30): "both" (the default, no filtering),
   * "male", or "female". A strong preference, not a promise (story 31) — a
   * narrowing filter prefers declared logged-in users of that gender and relaxes
   * to everyone (guests included) once the participant passes their gender
   * relaxation window. Guests are always "both".
   */
  genderFilter: GenderFilter;
}

/**
 * Stable key for a participant's identity, used to dedupe queue membership (one
 * slot per identity, even across browser tabs) and to exclude a user from
 * matching with themselves. Combines kind + id so a guest session and a
 * logged-in user can never collide on the same id.
 */
export function identityKey(identity: RealtimeIdentity): string {
  return `${identity.kind}:${identity.id}`;
}

/**
 * Inputs to the staged pairing step (stories 31-33, 36). The pool first honors
 * the joiner's {@link language} and gender constraints; failing that it relaxes
 * each axis independently for a waiter who has waited at least the matching
 * window. Passing the joiner's own key as {@link excludeKey} keeps a duplicate
 * join (e.g. a second tab) from self-matching.
 */
export interface MatchCriteria {
  /** Identity key to never return (the joiner themselves). */
  excludeKey: string;
  /** The joiner's matching language; same-language waiters are preferred. */
  language: LanguageCode;
  /** Reference time (epoch ms) for evaluating each waiter's relaxation window. */
  now: number;
  /** How long (ms) a waiter must have waited to be eligible across languages. */
  relaxAfterMs: number;
  /**
   * Whether gender filtering applies at all. False when the `gender_filters`
   * kill switch is off (story 84): every gender constraint — the joiner's and
   * every waiter's — is ignored so the pool behaves as if no one filtered.
   */
  genderFilteringEnabled: boolean;
  /**
   * The joiner's self-declared gender, used to satisfy a *waiter's* filter. Null
   * for guests and undeclared users; never satisfies a Male/Female filter.
   */
  gender: UserGender | null;
  /** The joiner's own gender filter; constrains which waiters are acceptable. */
  genderFilter: GenderFilter;
  /**
   * How long (ms) a waiter must have waited before their gender preference (both
   * the joiner's filter against them and their own filter) relaxes to allow a
   * fallback match — the visible wait window of stories 32-33.
   */
  genderRelaxAfterMs: number;
}

/**
 * Whether a gender {@link GenderFilter} is satisfied by a candidate's declared
 * {@link UserGender}. "Both" carries no constraint; a narrowing Male/Female
 * filter is met only by that exact declared gender — so a guest (null), an
 * undeclared user (null), or a `prefer_not_to_say` user never satisfies it,
 * which is exactly why such users are the *fallback* the filter relaxes to
 * (stories 32-33, 35) rather than a preferred match.
 */
export function genderFilterSatisfiedBy(
  filter: GenderFilter,
  gender: UserGender | null
): boolean {
  return filter === "both" || gender === filter;
}

/**
 * Persistence contract for the shared matching pool. The PRD puts matchmaking
 * queues in Redis (`issues/prd.md`), so production wires a Redis implementation;
 * an in-memory implementation keeps the slice demoable and unit-testable without
 * Redis. Mirrors the store seam already used for sessions (`SESSION_STORE`).
 *
 * Each primitive is individually atomic; {@link MatchmakingService} composes
 * them into the join/leave flow. Ordering is oldest-first (FIFO) so nobody
 * starves while newer arrivals get paired.
 */
export interface MatchmakingQueue {
  /**
   * Add a participant to the tail of the pool. If an entry for the same identity
   * already exists it is replaced (e.g. a reconnect from a new socket) and
   * `false` is returned; a brand-new entry returns `true`.
   */
  enqueue(participant: QueuedParticipant): Promise<boolean>;
  /** Remove the entry for an identity. Returns true if one was waiting. */
  remove(key: string): Promise<boolean>;
  /** Whether an identity is currently waiting. */
  contains(key: string): Promise<boolean>;
  /**
   * Atomically remove and return the best partner for a joiner under staged
   * language *and* gender relaxation (stories 31-33, 36), or null if no suitable
   * waiter exists. A waiter is *acceptable* when both axes pass:
   *
   *   - language: the joiner shares the waiter's language, OR the waiter has
   *     waited past `relaxAfterMs` (relaxed across languages);
   *   - gender: the joiner's filter is satisfied by the waiter's declared gender,
   *     AND the waiter's own filter is satisfied by the joiner's gender OR the
   *     waiter has waited past `genderRelaxAfterMs`. Both sides' strong
   *     preferences are honored until each waiter's own window lapses, after
   *     which they fall back to anyone — guests included (story 35).
   *
   * Among acceptable waiters, an *ideal* one (same language and both filters met
   * with no relaxation) is taken first; otherwise the oldest acceptable waiter
   * wins. Evaluation is oldest-first so nobody starves within a tier. A waiter
   * still inside both windows whose constraints aren't met is left in the pool.
   * {@link MatchCriteria.excludeKey} is never returned, so a user (even across
   * duplicate tabs) can never match themselves.
   */
  takeMatch(criteria: MatchCriteria): Promise<QueuedParticipant | null>;
  /**
   * Remove whichever entry is held on `socketId` (disconnect cleanup). Returns
   * the removed identity key, or null if that socket held no queue slot.
   */
  removeBySocket(socketId: string): Promise<string | null>;
  /** Number of participants currently waiting. */
  size(): Promise<number>;
}

export const MATCHMAKING_QUEUE = Symbol("MATCHMAKING_QUEUE");

/**
 * The joiner's soft matching preferences, passed to {@link
 * import("./matchmaking.service").MatchmakingService.join}. All optional with
 * safe defaults: {@link language} defaults to the supported default, and gender
 * is treated as "no preference" (filter "both", gender null) — the right default
 * for a guest, who never declares either. A logged-in joiner's values are
 * resolved server-side from their stored account, never asserted by the client.
 */
export interface JoinPreferences {
  /** Matching language signal (stories 26-28, 36). */
  language?: LanguageCode;
  /** Self-declared gender shown to others' filters (story 29). */
  gender?: UserGender | null;
  /** The joiner's own gender filter (story 30). */
  genderFilter?: GenderFilter;
}

/**
 * A created one-to-one match. The pairing is symmetric, but WebRTC and other
 * later slices need a deterministic initiator, so one side is tagged
 * `initiator` (the joining user who triggered the pair) and the other
 * `responder` (the user who was already waiting).
 */
export interface Match {
  matchId: string;
  createdAt: string;
  initiator: QueuedParticipant;
  responder: QueuedParticipant;
}

/**
 * Outcome of a join attempt. `unavailable` is returned when the `queue_entry`
 * kill switch is off (story 84) so the gateway can tell the user the pool is
 * closed rather than silently dropping them. `rate_limited` is returned when the
 * joiner has hit their queue-join threshold (stories 142-144) — stricter for
 * guests — carrying how long until they may retry so the gateway can say so
 * rather than silently dropping the attempt.
 */
export type JoinResult =
  | { status: "matched"; match: Match }
  | { status: "queued" }
  | { status: "unavailable" }
  | { status: "rate_limited"; retryAfterSeconds: number };

/**
 * Internal queue-health snapshot for operators (story 38). Deliberately a
 * *private ops* surface — the PRD omits public online counts (story 37), so
 * `waiting` is never exposed to end users, only here for matching-problem
 * detection. Counters are cumulative since process start.
 */
export interface QueueMetrics {
  /** Participants currently waiting to be matched. */
  waiting: number;
  /** Total successful join calls accepted into the pool or matched. */
  totalJoins: number;
  /** Total matches created (each pairs two joins). */
  totalMatches: number;
  /**
   * Matches where both sides shared a matching language (story 36). High vs.
   * {@link totalRelaxedMatches} tells operators language pools are healthy.
   */
  totalLanguageMatches: number;
  /**
   * Matches that needed cross-language relaxation because no same-language
   * partner was available in time (story 36). A rising share signals thin
   * language pools / long language waits worth investigating (story 38).
   */
  totalRelaxedMatches: number;
  /**
   * Matches where a gender filter was in play (one or both sides narrowed) and
   * fully honored — the filtering user got a declared logged-in user of their
   * chosen gender (story 32). High vs. {@link totalGenderRelaxedMatches} tells
   * operators gender inventory is healthy.
   */
  totalGenderFilteredMatches: number;
  /**
   * Matches where a gender filter was in play but *not* met, so the filtering
   * user fell back to a guest or a non-matching logged-in user after their
   * visible wait window (stories 33, 35). A rising share signals thin
   * gender inventory worth investigating (story 38).
   */
  totalGenderRelaxedMatches: number;
  /** Total explicit leaves (user left the queue before matching). */
  totalLeaves: number;
  /** Joins rejected because the queue_entry kill switch was off. */
  totalRejectedUnavailable: number;
  /**
   * Join attempts throttled because the joiner exceeded their queue-join rate
   * limit (stories 142-144). A rising count signals abuse pressure or a buggy
   * client retrying in a tight loop — exactly the bot-overload signal the limit
   * exists to contain (story 144), surfaced here for operator visibility.
   */
  totalRateLimited: number;
}

/** Socket.IO event names for the matchmaking surface (the realtime contract). */
export const MATCHMAKING_EVENTS = {
  /** Client → server: ask to join the shared pool. */
  join: "queue:join",
  /** Client → server: leave the pool without matching. */
  leave: "queue:leave",
  /** Server → client: acknowledged, now waiting for a partner. */
  waiting: "queue:waiting",
  /** Server → client: acknowledged a leave. */
  left: "queue:left",
  /** Server → client: the queue is closed (kill switch off) or join failed. */
  error: "queue:error",
  /** Server → client: join attempt throttled; carries `retryAfterSeconds`. */
  rateLimited: "queue:rate-limited",
  /** Server → client: paired with a stranger; carries the match handle. */
  matchFound: "match:found",
} as const;

/**
 * Payload delivered to each side of a new match. Intentionally minimal: it
 * carries the shared {@link Match.matchId} and this client's role, but *not* the
 * partner's identity — the stranger's generated display name/avatar is attached
 * by the chat slice (#21/#15), and the raw partner id is never exposed.
 */
export interface MatchFoundPayload {
  matchId: string;
  role: "initiator" | "responder";
}

/**
 * Payload for the {@link MATCHMAKING_EVENTS.rateLimited} event: the joiner hit
 * their queue-join threshold (stories 142-144). Carries the whole-second wait
 * until they may retry so the web app can show an honest "slow down, try again
 * in N seconds" rather than appearing to hang.
 */
export interface RateLimitedPayload {
  retryAfterSeconds: number;
}
