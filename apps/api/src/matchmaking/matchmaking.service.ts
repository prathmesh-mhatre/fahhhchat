import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  defaultGenderFilter,
  defaultLanguage,
  productConfig,
} from "@fahhhchat/config";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import {
  MATCHMAKING_QUEUE,
  genderFilterSatisfiedBy,
  identityKey,
  type JoinPreferences,
  type JoinResult,
  type Match,
  type MatchmakingQueue,
  type QueueMetrics,
  type QueuedParticipant,
} from "./matchmaking.types";

/**
 * The shared global matching pool (stories 24-25). Guests and logged-in users
 * go into *one* pool — there is no separate inventory and no region filter — and
 * the oldest waiting stranger is paired with the next joiner. Matching is
 * *staged* (stories 31-33, 36): a joiner first prefers a partner who shares their
 * matching language, and the pool relaxes across languages for waiters who have
 * been holding out longer than {@link productConfig.languageRelaxAfterSeconds},
 * so language stays relevant initially but never lets wait times balloon. Gender
 * filtering layers on as a second soft constraint with its own visible wait
 * window ({@link productConfig.genderRelaxAfterSeconds}): a logged-in user with a
 * Male/Female filter first gets declared logged-in users of that gender, then
 * falls back to guests (and non-matching logged-in users) once they pass the
 * window — a strong preference, never a promise (story 31). The `gender_filters`
 * kill switch (story 84) disables it wholesale.
 *
 * Queue entry is a launch kill switch (story 84): when `queue_entry` is off the
 * pool is closed and joins are rejected. Cumulative counters back the operator
 * health metrics (story 38); the pool size itself is never exposed publicly
 * (story 37, no public online counts).
 */
@Injectable()
export class MatchmakingService {
  private totalJoins = 0;
  private totalMatches = 0;
  private totalLanguageMatches = 0;
  private totalRelaxedMatches = 0;
  private totalGenderFilteredMatches = 0;
  private totalGenderRelaxedMatches = 0;
  private totalLeaves = 0;
  private totalRejectedUnavailable = 0;
  private totalRateLimited = 0;

  constructor(
    @Inject(MATCHMAKING_QUEUE) private readonly queue: MatchmakingQueue,
    private readonly flags: FeatureFlagsService,
    private readonly rateLimits: RateLimitService
  ) {}

  /**
   * Join the shared pool. Returns `matched` with a {@link Match} when a partner
   * was waiting, `queued` when the user is now waiting for one, `unavailable`
   * when the `queue_entry` kill switch is off, or `rate_limited` when the joiner
   * has exceeded their queue-join threshold (stories 142-144). Joining while
   * already queued is idempotent: the user keeps a single slot (refreshed onto
   * the latest socket).
   *
   * The rate-limit check runs *first*, before the kill switch, so a bot hammering
   * join is throttled even while the queue is closed — every attempt is counted,
   * which is exactly the overload the limit exists to contain (story 144). The
   * threshold is stricter for guests than logged-in users (stories 142-143).
   *
   * `prefs` are the joiner's soft matching signals — language (story 36) plus
   * declared gender and gender filter (stories 31-33). They only steer *who* you
   * meet, never safety, so the joiner's *filter* and *language* may be passed
   * straight through; their declared *gender* is the value others filter on, so
   * the gateway resolves it server-side from the stored account rather than
   * trusting the client. The pool prefers a same-language partner and a
   * filter-satisfying one, relaxing each axis for waiters past its window.
   */
  async join(
    identity: RealtimeIdentity,
    socketId: string,
    prefs: JoinPreferences = {},
    now: Date = new Date()
  ): Promise<JoinResult> {
    const decision = await this.rateLimits.consume("queue_join", identity, now);
    if (!decision.allowed) {
      this.totalRateLimited += 1;
      return {
        status: "rate_limited",
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }

    if (!(await this.flags.isEnabled("queue_entry"))) {
      this.totalRejectedUnavailable += 1;
      return { status: "unavailable" };
    }

    const language = prefs.language ?? defaultLanguage;
    const gender = prefs.gender ?? null;
    const genderFilter = prefs.genderFilter ?? defaultGenderFilter;
    // Gender filtering is itself a launch kill switch (story 84): while it is off
    // every filter — the joiner's and every waiter's — is ignored.
    const genderFilteringEnabled = await this.flags.isEnabled("gender_filters");

    this.totalJoins += 1;
    const key = identityKey(identity);
    const joiner: QueuedParticipant = {
      identity,
      socketId,
      enqueuedAt: now.getTime(),
      language,
      gender,
      genderFilter,
    };

    // Pair with the best available *other* user under staged language + gender
    // relaxation. Excluding our own key means a duplicate join (e.g. a second
    // tab) can never match a user with themselves — they just refresh their
    // single waiting slot below.
    const partner = await this.queue.takeMatch({
      excludeKey: key,
      language,
      now: now.getTime(),
      relaxAfterMs: productConfig.languageRelaxAfterSeconds * 1000,
      genderFilteringEnabled,
      gender,
      genderFilter,
      genderRelaxAfterMs: productConfig.genderRelaxAfterSeconds * 1000,
    });
    if (partner) {
      // The joiner triggered the pair, so they are the initiator; the user who
      // was already waiting is the responder (deterministic for later WebRTC).
      await this.queue.remove(key);
      const match: Match = {
        matchId: randomUUID(),
        createdAt: now.toISOString(),
        initiator: joiner,
        responder: partner,
      };
      this.totalMatches += 1;
      this.recordMatchHealth(joiner, partner, genderFilteringEnabled);
      return { status: "matched", match };
    }

    await this.queue.enqueue(joiner);
    return { status: "queued" };
  }

  /**
   * Tally the story-38 health signals for a freshly created pair: whether
   * language and (when filtering is on and a filter was in play) gender were
   * honored at full strength, or the match relied on relaxation. The pair is
   * symmetric, so gender is judged from both sides' filters.
   */
  private recordMatchHealth(
    joiner: QueuedParticipant,
    partner: QueuedParticipant,
    genderFilteringEnabled: boolean
  ): void {
    // Same-language counts as a language match; anything else only paired because
    // the partner had relaxed past the language window.
    if (partner.language === joiner.language) {
      this.totalLanguageMatches += 1;
    } else {
      this.totalRelaxedMatches += 1;
    }

    const filtersInPlay =
      genderFilteringEnabled &&
      (joiner.genderFilter !== "both" || partner.genderFilter !== "both");
    if (filtersInPlay) {
      const bothHonored =
        genderFilterSatisfiedBy(joiner.genderFilter, partner.gender) &&
        genderFilterSatisfiedBy(partner.genderFilter, joiner.gender);
      if (bothHonored) {
        this.totalGenderFilteredMatches += 1;
      } else {
        this.totalGenderRelaxedMatches += 1;
      }
    }
  }

  /** Leave the pool without matching. Returns true if the user was waiting. */
  async leave(identity: RealtimeIdentity): Promise<boolean> {
    const removed = await this.queue.remove(identityKey(identity));
    if (removed) {
      this.totalLeaves += 1;
    }
    return removed;
  }

  /**
   * Drop whatever queue slot a disconnecting socket held. Distinct from
   * {@link leave} (it isn't a deliberate user action) so it doesn't inflate the
   * leave counter; it just keeps the pool from holding dead sockets.
   */
  async handleDisconnect(socketId: string): Promise<void> {
    await this.queue.removeBySocket(socketId);
  }

  /** Internal queue-health snapshot for operators (story 38). */
  async metrics(): Promise<QueueMetrics> {
    return {
      waiting: await this.queue.size(),
      totalJoins: this.totalJoins,
      totalMatches: this.totalMatches,
      totalLanguageMatches: this.totalLanguageMatches,
      totalRelaxedMatches: this.totalRelaxedMatches,
      totalGenderFilteredMatches: this.totalGenderFilteredMatches,
      totalGenderRelaxedMatches: this.totalGenderRelaxedMatches,
      totalLeaves: this.totalLeaves,
      totalRejectedUnavailable: this.totalRejectedUnavailable,
      totalRateLimited: this.totalRateLimited,
    };
  }
}
