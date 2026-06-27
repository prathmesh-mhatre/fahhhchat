import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { containsUrlLike, productConfig } from "@fahhhchat/config";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { RematchGuardService } from "../rematch/rematch-guard.service";
import type { Match } from "../matchmaking/matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import {
  CHAT_STORE,
  DISPLAY_NAME_RESOLVER,
  FALLBACK_DISPLAY_NAME,
  chatIdentityKey,
  type ActiveMatch,
  type BeginReconnectGraceResult,
  type ChatMessage,
  type ChatStore,
  type DisplayNameResolver,
  type EndedMatch,
  type MatchEndReason,
  type ReportSubmission,
  type ResumeResult,
  type SendMessagePayload,
  type SendResult,
  type TypingResult,
} from "./chat.types";

/**
 * Routes realtime text between the two users of an active match and guards the
 * match boundary (issue #21). It is the only place that turns a proposed send
 * into a stamped, acknowledged, delivered message, and the only place that knows
 * which messages are still allowed:
 *
 *   - **Delivery + acknowledgement (story 39):** a send is stamped with a
 *     server message id and timestamp, appended to the match's ephemeral buffer,
 *     and returned with the recipient's socket so the gateway can fan it out and
 *     acknowledge the sender from one authoritative clock.
 *   - **Ephemeral, match-scoped history (story 46):** the recent conversation
 *     lives only in the match's bounded buffer and is dropped the instant the
 *     match ends, so chat history never persists.
 *   - **Match-end guardrail (story 43):** once a match has ended (or never
 *     existed) a send is refused as `no_active_match`, so a late or retried
 *     message is never delivered out of context.
 *
 * Socket.IO, feature flags, and notification fan-out stay in the gateway; this
 * service is pure match/chat logic over the {@link ChatStore} seam so it is
 * unit-testable without a socket server.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_STORE) private readonly store: ChatStore,
    @Inject(DISPLAY_NAME_RESOLVER)
    private readonly displayNames: DisplayNameResolver,
    private readonly rateLimits: RateLimitService,
    private readonly rematchGuard: RematchGuardService,
  ) {}

  /**
   * Register a freshly created pairing so its messages can be routed. Called by
   * the matchmaking gateway the moment two users are paired; it translates the
   * matchmaking {@link Match} (which carries full queue participants) into the
   * minimal {@link ActiveMatch} chat needs — identity key, role, and socket per
   * side — and never retains anything else about the users.
   */
  async registerMatch(match: Match): Promise<void> {
    // Resolve each side's generated display name once, here, and freeze it on the
    // match. Typing indicators (story 40) read it back without another lookup,
    // and a mid-match rename can't change the name the stranger already sees.
    const [initiatorName, responderName] = await Promise.all([
      this.resolveDisplayName(match.initiator.identity),
      this.resolveDisplayName(match.responder.identity),
    ]);
    const active: ActiveMatch = {
      matchId: match.matchId,
      createdAt: match.createdAt,
      participants: [
        {
          identityKey: chatIdentityKey(match.initiator.identity),
          role: "initiator",
          socketId: match.initiator.socketId,
          displayName: initiatorName,
          connected: true,
        },
        {
          identityKey: chatIdentityKey(match.responder.identity),
          role: "responder",
          socketId: match.responder.socketId,
          displayName: responderName,
          connected: true,
        },
      ],
    };
    await this.store.createMatch(active);
  }

  /** Resolve a display name, falling back to a neutral name if it's gone. */
  private async resolveDisplayName(
    identity: RealtimeIdentity,
  ): Promise<string> {
    const name = await this.displayNames.resolve(identity);
    return name ?? FALLBACK_DISPLAY_NAME;
  }

  /**
   * Attempt to send a message from {@link identity} in their current match.
   * Resolves to `delivered` (with the stamped message and the recipient socket),
   * `no_active_match` when the sender is not in a live match (the story-43
   * guardrail), `invalid` when the text is empty or over
   * {@link productConfig.chatMessageMaxLength}, or `spam` when the message is
   * URL-like and the sender has exhausted their link budget (story 45). The text
   * is trimmed before validation, the spam check, and delivery so trailing
   * whitespace can't smuggle past the length bound or turn a blank message into a
   * "non-empty" one.
   *
   * The link-spam check runs *only* for URL-bearing messages and *after* the
   * cheap validation, so an ordinary message never touches the `chat_link`
   * counter and a malformed one is rejected on its own terms first. URLs are
   * never rewritten or stripped — the message still carries its plain text
   * through to delivery, where the recipient renders it as inert text (story 44);
   * the budget only gates *how many* link messages a sender may fire in a window.
   */
  async send(
    identity: RealtimeIdentity,
    payload: SendMessagePayload,
    now: Date = new Date(),
  ): Promise<SendResult> {
    const senderKey = chatIdentityKey(identity);
    const match = await this.store.getMatchByIdentity(senderKey);
    if (!match) {
      return { status: "no_active_match" };
    }

    const text = (payload.text ?? "").trim();
    if (text.length === 0) {
      return { status: "invalid", reason: "empty" };
    }
    if (text.length > productConfig.chatMessageMaxLength) {
      return { status: "invalid", reason: "too_long" };
    }

    // Spam control (story 45): a URL-bearing message counts against the sender's
    // link budget. Only link messages are metered, so ordinary chat is never
    // throttled; once the budget is spent the message is refused rather than
    // delivered, and the sender is told how long until a link will go through.
    if (containsUrlLike(text)) {
      const decision = await this.rateLimits.consume("chat_link", identity, now);
      if (!decision.allowed) {
        return { status: "spam", retryAfterSeconds: decision.retryAfterSeconds };
      }
    }

    const sender = match.participants.find((p) => p.identityKey === senderKey);
    const recipient = match.participants.find(
      (p) => p.identityKey !== senderKey,
    );
    // Both are guaranteed present: the match was found *by* the sender's key, and
    // a match always has exactly two distinct participants. The guard satisfies
    // the type narrowing and would catch a corrupted record rather than throw.
    if (!sender || !recipient) {
      return { status: "no_active_match" };
    }

    const message: ChatMessage = {
      matchId: match.matchId,
      messageId: randomUUID(),
      from: sender.role,
      text,
      sentAt: now.toISOString(),
    };
    await this.store.appendMessage(match.matchId, message);

    return {
      status: "delivered",
      message,
      recipientSocketId: recipient.socketId,
    };
  }

  /**
   * Relay a typing toggle from {@link identity} to their match partner (story
   * 40). Resolves to `relay` (with the partner's socket and the *sender's* role
   * and frozen display name, so the partner can show "<name> is typing…"), or
   * `no_active_match` when the sender is not in a live match — the same match
   * boundary that guards `send`, so a stale typing event after a match end is
   * dropped rather than delivered out of context. Carries no message content and
   * never acknowledges the sender, so it can't become a read receipt (story 41).
   */
  async typing(
    identity: RealtimeIdentity,
    isTyping: boolean,
  ): Promise<TypingResult> {
    const senderKey = chatIdentityKey(identity);
    const match = await this.store.getMatchByIdentity(senderKey);
    if (!match) {
      return { status: "no_active_match" };
    }

    const sender = match.participants.find((p) => p.identityKey === senderKey);
    const recipient = match.participants.find(
      (p) => p.identityKey !== senderKey,
    );
    if (!sender || !recipient) {
      return { status: "no_active_match" };
    }

    return {
      status: "relay",
      matchId: match.matchId,
      recipientSocketId: recipient.socketId,
      from: sender.role,
      displayName: sender.displayName,
      isTyping,
    };
  }

  /**
   * Handle a socket dropping while in a match by opening a short same-session
   * reconnect grace window instead of ending the chat outright (story 47). The
   * dropped participant is marked disconnected with a deadline of
   * {@link productConfig.reconnectGraceSeconds} from {@link now}; the match and
   * its buffer stay alive so a returning socket can {@link resume}. Resolves to:
   *
   *   - `grace` — the partner is still here, so the match is held; the caller arms
   *     a teardown timer and tells the partner to wait.
   *   - `ended` — the partner was already away, so there is no one to hold the
   *     chat open for and it is torn down immediately.
   *   - `none` — the socket held no live match (only queued, or already gone).
   *
   * Story 48 (media expires immediately, even during text grace) is the deliberate
   * exception to this grace: only text chat survives the window. Per-match media
   * consent and pending camera media (issues #39+) are not built yet; when they
   * are, their immediate teardown belongs here, *before* the text match is held.
   */
  async beginReconnectGrace(
    socketId: string,
    now: Date = new Date(),
  ): Promise<BeginReconnectGraceResult> {
    const graceExpiresAt = new Date(
      now.getTime() + productConfig.reconnectGraceSeconds * 1000,
    ).toISOString();
    const mark = await this.store.markDisconnected(socketId, graceExpiresAt);
    if (!mark) {
      return { status: "none" };
    }

    if (!mark.partner.connected) {
      // The partner is already away (mid-grace or gone): nobody is on the other
      // side to wait for, so end now rather than holding an empty window open.
      const ended = await this.endMatch(
        mark.match.matchId,
        "partner_disconnected",
        socketId,
      );
      return ended ? { status: "ended", ended } : { status: "none" };
    }

    return {
      status: "grace",
      matchId: mark.match.matchId,
      participantKey: mark.participantKey,
      graceExpiresAt,
      partnerSocketId: mark.partner.socketId,
    };
  }

  /**
   * Re-bind a reconnecting session to the match it briefly dropped out of (story
   * 47). The match is resolved from the caller's *identity* — the same browser
   * session, not the same socket — so a different user can never resume someone
   * else's chat. Resolves to `resumed` (with the role, the recent buffer to
   * repaint, and the partner's presence) when the match is still within grace, or
   * `no_active_match` when there is nothing to resume; if the grace window had
   * already lapsed, the lingering match is torn down here and the teardown is
   * returned so the caller can also notify the partner.
   */
  async resume(
    identity: RealtimeIdentity,
    newSocketId: string,
    now: Date = new Date(),
  ): Promise<ResumeResult> {
    const identityKey = chatIdentityKey(identity);
    const match = await this.store.getMatchByIdentity(identityKey);
    const self = match?.participants.find((p) => p.identityKey === identityKey);
    if (!match || !self) {
      return { status: "no_active_match", ended: null };
    }

    // A grace window that already elapsed leaves a zombie match the teardown timer
    // hasn't reaped yet (e.g. a multi-instance node whose timer never fired). End
    // it and refuse the resume rather than reviving a chat the partner has left.
    if (
      !self.connected &&
      self.graceExpiresAt !== undefined &&
      new Date(self.graceExpiresAt).getTime() <= now.getTime()
    ) {
      const ended = await this.endMatch(match.matchId, "timeout", newSocketId);
      return { status: "no_active_match", ended };
    }

    const reattached = await this.store.reattach(identityKey, newSocketId);
    const partner = reattached?.participants.find(
      (p) => p.identityKey !== identityKey,
    );
    if (!reattached || !partner) {
      return { status: "no_active_match", ended: null };
    }

    return {
      status: "resumed",
      matchId: reattached.matchId,
      role: self.role,
      buffer: await this.store.getBuffer(reattached.matchId),
      partnerConnected: partner.connected,
      partnerSocketId: partner.connected ? partner.socketId : null,
    };
  }

  /**
   * Tear down a match whose reconnect grace window has lapsed without the
   * participant returning (story 47). A no-op — returning null — if the match is
   * already gone, the participant reconnected (so is now `connected`), or the
   * deadline has not actually passed yet, so a stale or early timer firing can
   * never end a healthy chat. On a genuine lapse the match ends with `timeout` and
   * the still-present partner is reported for notification.
   */
  async expireReconnectGrace(
    matchId: string,
    participantKey: string,
    now: Date = new Date(),
  ): Promise<EndedMatch | null> {
    const match = await this.store.getMatchByIdentity(participantKey);
    if (!match || match.matchId !== matchId) {
      return null;
    }
    const participant = match.participants.find(
      (p) => p.identityKey === participantKey,
    );
    if (!participant || participant.connected) {
      return null;
    }
    if (
      participant.graceExpiresAt !== undefined &&
      new Date(participant.graceExpiresAt).getTime() > now.getTime()
    ) {
      return null;
    }
    return this.endMatch(matchId, "timeout");
  }

  /**
   * End the match a disconnecting socket belonged to, if any. Drops the match and
   * its buffer (so no further sends route and history is gone) and reports which
   * *other* sockets remain to be told the chat is over. Returns null when the
   * socket held no live match — making disconnect cleanup idempotent and cheap
   * for sockets that were only ever queued or already torn down.
   */
  async endMatchForSocket(
    socketId: string,
    reason: MatchEndReason,
  ): Promise<EndedMatch | null> {
    const match = await this.store.getMatchBySocket(socketId);
    if (!match) {
      return null;
    }
    return this.endMatch(match.matchId, reason, socketId);
  }

  /**
   * Permanently close the match the caller is in because they confirmed the
   * two-step Next control (issue #26, story 51). The match is resolved from the
   * caller's *identity* — never client input — so a user can only ever Next their
   * own current chat. The caller's own socket is excluded from the notify list:
   * its client already transitioned on the confirmed click and is about to requeue
   * itself, so only the *partner* is told the chat ended (with reason `next`). A
   * no-op returning null when the caller is not in a live match (already ended, or
   * never matched), which keeps a double-Next or a Next racing a disconnect safe.
   */
  async nextMatch(identity: RealtimeIdentity): Promise<EndedMatch | null> {
    const callerKey = chatIdentityKey(identity);
    const match = await this.store.getMatchByIdentity(callerKey);
    if (!match) {
      return null;
    }
    const caller = match.participants.find((p) => p.identityKey === callerKey);
    return this.endMatch(match.matchId, "next", caller?.socketId);
  }

  /**
   * Report the stranger the caller is matched with, ending the match (issue #27,
   * stories 52, 55-56). Reporting immediately and permanently closes the match so
   * the caller can leave an unsafe interaction; when {@link ReportSubmission.alsoBlock}
   * is set (the default — story 56), it also records a rematch-prevention block so
   * the two are not paired again right away (story 54). The match is resolved from
   * the caller's *identity*, never client input, so a user can only report their own
   * current chat. The block is recorded *before* the match is torn down because
   * teardown drops the participant records the partner's identity key is read
   * from. Like {@link nextMatch}, the caller's own socket is excluded from the
   * notify list (their client already transitioned), so only the partner is told
   * the chat ended — with reason `report`, which the client renders as a neutral
   * end, never "you were reported". A no-op returning null when the caller is not
   * in a live match, keeping a double-report or a report racing a disconnect safe.
   *
   * The {@link submission} carries the validated report form — its category and
   * optional details (issue #28, stories 59-61) — already normalised by the gateway,
   * so a report always has a settled category. This slice owns the termination +
   * also-block half plus the *contract* for that form data; capturing the
   * surrounding chat context (issue #29) and opening a trust-weighted moderator case
   * (issue #30) are the slices that consume {@link ReportSubmission.category} and
   * {@link ReportSubmission.details}, so they ride along on the submission here
   * rather than being re-plumbed later.
   */
  async reportMatch(
    identity: RealtimeIdentity,
    submission: ReportSubmission,
    now: Date = new Date(),
  ): Promise<EndedMatch | null> {
    return this.endSafetyMatch(identity, "report", submission.alsoBlock, now);
  }

  /**
   * Block the stranger the caller is matched with, ending the match (issue #27,
   * stories 53-55). A separate control from {@link reportMatch} (story 55):
   * blocking immediately closes the match (story 53) and always records a
   * rematch-prevention block so the two are not paired again right away (story
   * 54), but files no report. Resolved from the caller's identity and notified
   * exactly like report (partner-only, neutral). A no-op returning null when the
   * caller is not in a live match.
   */
  async blockMatch(
    identity: RealtimeIdentity,
    now: Date = new Date(),
  ): Promise<EndedMatch | null> {
    return this.endSafetyMatch(identity, "block", true, now);
  }

  /**
   * Shared body of {@link reportMatch} and {@link blockMatch}: resolve the
   * caller's live match, optionally record the mutual rematch-prevention block
   * between the two participants (stories 53-54), then tear the match down with
   * the given safety {@link reason} and report the partner for notification. The
   * partner's identity key is captured before {@link endMatch} runs, since
   * teardown removes the participant records. Returns null when the caller holds
   * no live match.
   */
  private async endSafetyMatch(
    identity: RealtimeIdentity,
    reason: "report" | "block",
    block: boolean,
    now: Date,
  ): Promise<EndedMatch | null> {
    const callerKey = chatIdentityKey(identity);
    const match = await this.store.getMatchByIdentity(callerKey);
    if (!match) {
      return null;
    }
    const caller = match.participants.find((p) => p.identityKey === callerKey);
    const partner = match.participants.find(
      (p) => p.identityKey !== callerKey,
    );

    if (block && partner) {
      // Record the mutual exclusion before teardown drops the participant records
      // (stories 53-54). Mutual, so a later join from either side skips the other.
      await this.rematchGuard.preventRematch(
        callerKey,
        partner.identityKey,
        now,
      );
    }

    return this.endMatch(match.matchId, reason, caller?.socketId);
  }

  /**
   * Tear a match down and report whom to notify. {@link excludeSocketId} is the
   * socket that triggered the end (e.g. the one that disconnected); it is left
   * out of the notify list since it is gone or already knows. Idempotent: a match
   * already removed by a racing teardown returns null.
   */
  async endMatch(
    matchId: string,
    reason: MatchEndReason,
    excludeSocketId?: string,
  ): Promise<EndedMatch | null> {
    const removed = await this.store.removeMatch(matchId);
    if (!removed) {
      return null;
    }
    // Notify only participants who are still connected and aren't the socket that
    // triggered the end. A participant inside the reconnect grace window (story 47)
    // has a dead socket, so there's no point — and no way — to reach them.
    const notifySocketIds = removed.participants
      .filter((p) => p.connected && p.socketId !== excludeSocketId)
      .map((p) => p.socketId);
    return { matchId, reason, notifySocketIds };
  }

  /**
   * The active match an identity is in, or null. Exposed for the gateway/tests to
   * assert routing state without reaching into the store.
   */
  async activeMatchFor(
    identity: RealtimeIdentity,
  ): Promise<ActiveMatch | null> {
    return this.store.getMatchByIdentity(chatIdentityKey(identity));
  }

  /** The ephemeral, match-scoped buffer for a match (oldest-first). */
  async buffer(matchId: string): Promise<ChatMessage[]> {
    return this.store.getBuffer(matchId);
  }
}
