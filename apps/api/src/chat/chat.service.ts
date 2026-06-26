import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import type { Match } from "../matchmaking/matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import {
  CHAT_STORE,
  DISPLAY_NAME_RESOLVER,
  FALLBACK_DISPLAY_NAME,
  chatIdentityKey,
  type ActiveMatch,
  type ChatMessage,
  type ChatStore,
  type DisplayNameResolver,
  type EndedMatch,
  type MatchEndReason,
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
        },
        {
          identityKey: chatIdentityKey(match.responder.identity),
          role: "responder",
          socketId: match.responder.socketId,
          displayName: responderName,
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
   * guardrail), or `invalid` when the text is empty or over
   * {@link productConfig.chatMessageMaxLength}. The text is trimmed before both
   * validation and delivery so trailing whitespace can't smuggle past the length
   * bound or turn a blank message into a "non-empty" one.
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
    const notifySocketIds = removed.participants
      .map((p) => p.socketId)
      .filter((socketId) => socketId !== excludeSocketId);
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
