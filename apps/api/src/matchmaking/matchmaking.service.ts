import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  defaultLanguage,
  productConfig,
  type LanguageCode,
} from "@fahhhchat/config";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import {
  MATCHMAKING_QUEUE,
  identityKey,
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
 * *staged* (story 36): a joiner first prefers a partner who shares their
 * matching language, and the pool relaxes across languages for waiters who have
 * been holding out longer than {@link productConfig.languageRelaxAfterSeconds},
 * so language stays relevant initially but never lets wait times balloon. Gender
 * filtering is a separate soft constraint that lands in #19.
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
  private totalLeaves = 0;
  private totalRejectedUnavailable = 0;

  constructor(
    @Inject(MATCHMAKING_QUEUE) private readonly queue: MatchmakingQueue,
    private readonly flags: FeatureFlagsService
  ) {}

  /**
   * Join the shared pool. Returns `matched` with a {@link Match} when a partner
   * was waiting, `queued` when the user is now waiting for one, or `unavailable`
   * when the `queue_entry` kill switch is off. Joining while already queued is
   * idempotent: the user keeps a single slot (refreshed onto the latest socket).
   *
   * `language` is the joiner's matching-language preference (a soft signal): the
   * pool prefers a same-language partner and only relaxes across languages for
   * waiters past the relaxation window (story 36). Trusting the caller-supplied
   * language is intentional — it only steers *who* you meet, never safety — so
   * the gateway can pass a guest's browser-seeded language without a preference
   * lookup. Defaults to {@link defaultLanguage} when unspecified.
   */
  async join(
    identity: RealtimeIdentity,
    socketId: string,
    language: LanguageCode = defaultLanguage,
    now: Date = new Date()
  ): Promise<JoinResult> {
    if (!(await this.flags.isEnabled("queue_entry"))) {
      this.totalRejectedUnavailable += 1;
      return { status: "unavailable" };
    }

    this.totalJoins += 1;
    const key = identityKey(identity);
    const joiner: QueuedParticipant = {
      identity,
      socketId,
      enqueuedAt: now.getTime(),
      language,
    };

    // Pair with the best available *other* user under staged language
    // relaxation. Excluding our own key means a duplicate join (e.g. a second
    // tab) can never match a user with themselves — they just refresh their
    // single waiting slot below.
    const partner = await this.queue.takeMatch({
      excludeKey: key,
      language,
      now: now.getTime(),
      relaxAfterMs: productConfig.languageRelaxAfterSeconds * 1000,
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
      // Same-language counts as a language match; anything else only paired
      // because the partner had relaxed past the window (story 38 health signal).
      if (partner.language === language) {
        this.totalLanguageMatches += 1;
      } else {
        this.totalRelaxedMatches += 1;
      }
      return { status: "matched", match };
    }

    await this.queue.enqueue(joiner);
    return { status: "queued" };
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
      totalLeaves: this.totalLeaves,
      totalRejectedUnavailable: this.totalRejectedUnavailable,
    };
  }
}
