import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
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
 * the oldest waiting stranger is paired with the next joiner. This is the
 * *basic* queue: it applies no language or gender preference (those soft
 * constraints land in #18 and #19), so any two distinct identities can match.
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
   */
  async join(
    identity: RealtimeIdentity,
    socketId: string,
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
    };

    // Pair with the longest-waiting *other* user, if any. Excluding our own key
    // means a duplicate join (e.g. a second tab) can never match a user with
    // themselves — they just refresh their single waiting slot below.
    const partner = await this.queue.takeOldestExcept(key);
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
      totalLeaves: this.totalLeaves,
      totalRejectedUnavailable: this.totalRejectedUnavailable,
    };
  }
}
