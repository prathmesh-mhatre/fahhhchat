import type { LanguageCode } from "@fahhhchat/config";
import type { RealtimeIdentity } from "../realtime/realtime.types";

/**
 * A single user waiting in the shared matching pool. The PRD uses *one* global
 * pool for both guests and logged-in users (stories 24-25, "one shared matching
 * pool"), so a participant is their realtime {@link RealtimeIdentity}, the socket
 * to reach them on, when they joined, and their matching-language preference.
 * Language is a *soft* signal: the pool prefers a same-language partner initially
 * and relaxes across languages over time (story 36); gender filtering is a
 * separate soft constraint that lands in #19.
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
 * Inputs to the staged pairing step (story 36). The pool first honors the
 * joiner's {@link language}; failing that it relaxes and pairs them with any
 * waiter who has waited at least {@link relaxAfterMs}. Passing the joiner's own
 * key as {@link excludeKey} keeps a duplicate join (e.g. a second tab) from
 * self-matching.
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
   * language relaxation (story 36), or null if no suitable waiter exists. The
   * preference order, evaluated oldest-first so nobody starves within a tier, is:
   *
   *   1. the oldest waiter sharing the joiner's {@link MatchCriteria.language};
   *   2. otherwise the oldest waiter who has already waited at least
   *      `relaxAfterMs` — relaxed across languages so wait times stay low and a
   *      long-waiting stranger isn't stranded.
   *
   * A waiter of a different language who is still inside their relaxation window
   * is left in the pool. {@link MatchCriteria.excludeKey} is never returned, so a
   * user (even across duplicate tabs) can never match themselves.
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
 * closed rather than silently dropping them.
 */
export type JoinResult =
  | { status: "matched"; match: Match }
  | { status: "queued" }
  | { status: "unavailable" };

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
  /** Total explicit leaves (user left the queue before matching). */
  totalLeaves: number;
  /** Joins rejected because the queue_entry kill switch was off. */
  totalRejectedUnavailable: number;
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
