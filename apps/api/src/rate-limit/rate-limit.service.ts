import { Inject, Injectable } from "@nestjs/common";
import { rateLimits, type RateLimitRule } from "@fahhhchat/config";
import {
  RATE_LIMIT_STORE,
  type RateLimitAction,
  type RateLimitDecision,
  type RateLimitIdentity,
  type RateLimitStore,
} from "./rate-limit.types";

/**
 * Layered abuse control for matching operations (stories 140-144). Counts each
 * attempt at an {@link RateLimitAction} against the caller's identity in a
 * fixed window and reports whether they are still under their tier's threshold.
 *
 * The tier comes from the identity kind: guests get the stricter limit, logged-in
 * users the higher-but-enforced one (stories 142-143), so login can never become
 * an abuse bypass. The key combines action + tier + identity id, so a guest's
 * queue joins and reconnects are throttled independently and one identity's
 * limit never bleeds into another's. The thresholds themselves are shared config
 * ({@link rateLimits}) so the web app can message the same numbers it is limited
 * by. Deliberately scoped to queue-join and reconnect: the PRD forbids a
 * rapid-Next cooldown (story 145), so Next is never passed here.
 *
 * This is one of the deep modules the PRD isolates for testing — pure decision
 * logic over a swappable {@link RateLimitStore} (in-memory for dev/tests, Redis
 * in production), time-injectable so window behavior is deterministic in tests.
 */
@Injectable()
export class RateLimitService {
  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore
  ) {}

  /**
   * Count one attempt at `action` by `identity` and decide whether it is
   * allowed. An attempt that lands exactly on the limit is allowed; the one
   * after it is throttled. Each call counts — callers should invoke this once
   * per real attempt and honor `allowed` before doing the work.
   */
  async consume(
    action: RateLimitAction,
    identity: RateLimitIdentity,
    now: Date = new Date()
  ): Promise<RateLimitDecision> {
    const rule = this.ruleFor(action, identity);
    const windowMs = rule.windowSeconds * 1000;
    const { count, resetAtMs } = await this.store.increment(
      this.keyFor(action, identity),
      windowMs,
      now.getTime()
    );

    const allowed = count <= rule.limit;
    const resetAt = new Date(resetAtMs).toISOString();
    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      // Only a throttled attempt needs to wait; round up so we never tell a
      // user to retry a fraction of a second before the window actually resets.
      retryAfterSeconds: allowed
        ? 0
        : Math.max(0, Math.ceil((resetAtMs - now.getTime()) / 1000)),
      resetAt,
    };
  }

  /** The tier-specific threshold for an action — guest stricter than user. */
  private ruleFor(
    action: RateLimitAction,
    identity: RateLimitIdentity
  ): RateLimitRule {
    return rateLimits[action][identity.kind === "user" ? "user" : "guest"];
  }

  /**
   * Counter key: action + tier + identity id. Including the tier keeps a guest
   * session and a logged-in account from ever colliding on the same id, and
   * scoping by action means joining and reconnecting burn separate budgets.
   */
  private keyFor(
    action: RateLimitAction,
    identity: RateLimitIdentity
  ): string {
    return `${action}:${identity.kind}:${identity.id}`;
  }
}
