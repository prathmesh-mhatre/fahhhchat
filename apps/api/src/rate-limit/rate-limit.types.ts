import type { RateLimitAction } from "@fahhhchat/config";
import type { RealtimeIdentity } from "../realtime/realtime.types";

/**
 * Persistence contract for the fixed-window counters behind the rate limiter.
 * The PRD puts rate limits in Redis (`issues/prd.md`), so production wires a
 * Redis implementation; an in-memory implementation keeps the slice demoable and
 * unit-testable without Redis. Mirrors the store seams already used for sessions
 * (`SESSION_STORE`) and the matching pool (`MATCHMAKING_QUEUE`).
 */
export interface RateLimitStore {
  /**
   * Atomically count one attempt against `key`. The first hit in an idle window
   * starts a fresh window of `windowMs`; subsequent hits within it increment the
   * same counter and leave the window's expiry untouched. Returns the
   * post-increment count and when the active window resets (epoch ms), so the
   * caller can decide whether the attempt is over the limit and how long until
   * it recovers.
   */
  increment(
    key: string,
    windowMs: number,
    now: number
  ): Promise<{ count: number; resetAtMs: number }>;
}

export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");

/**
 * Outcome of a rate-limit check. Returned by
 * {@link import("./rate-limit.service").RateLimitService.consume} for every
 * throttled action so callers can both enforce (`allowed`) and message the user
 * honestly (`retryAfterSeconds`, `resetAt`) without re-deriving the window math.
 */
export interface RateLimitDecision {
  /** False when this attempt put the identity over its threshold. */
  allowed: boolean;
  /** The threshold that applied (tier-specific), for messaging/telemetry. */
  limit: number;
  /** Attempts still permitted in the current window; 0 once throttled. */
  remaining: number;
  /** Whole seconds until the window resets; 0 when {@link allowed}. */
  retryAfterSeconds: number;
  /** ISO timestamp when the current window resets and attempts recover. */
  resetAt: string;
}

/**
 * The layered identity signal a rate-limit check is keyed on (story 140): the
 * logged-in account id or the guest session id. The identity's `kind` also
 * selects the tier — guests get stricter thresholds than users (stories
 * 142-143).
 */
export type RateLimitIdentity = RealtimeIdentity;

export type { RateLimitAction };
