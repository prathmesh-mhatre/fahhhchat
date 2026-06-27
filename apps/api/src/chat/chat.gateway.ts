import { Logger } from "@nestjs/common";
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { productConfig } from "@fahhhchat/config";
import { webOrigins } from "../cors-origins";
import type { AuthenticatedSocketData } from "../realtime/realtime.gateway";
import { ChatService } from "./chat.service";
import {
  CHAT_EVENTS,
  chatIdentityKey,
  type AckPayload,
  type ChatMessagePayload,
  type EndedMatch,
  type MatchEndedPayload,
  type PartnerDisconnectedPayload,
  type PartnerReconnectedPayload,
  type ResumeFailedPayload,
  type ResumedPayload,
  type SendFailedPayload,
  type SendMessagePayload,
  type TypingIndicatorPayload,
  type TypingPayload,
} from "./chat.types";

/**
 * Socket.IO surface for in-match text chat (issue #21). It rides the same server
 * and namespace as the realtime/matchmaking gateways — the connection was already
 * authenticated by {@link import("../realtime/realtime.gateway").RealtimeGateway}
 * (which stashed the verified identity on `socket.data`) and paired by
 * matchmaking (which registered the active match with {@link ChatService}).
 *
 * The gateway is deliberately thin: it pulls the verified identity off the
 * socket, hands the send to {@link ChatService}, and translates the result into
 * the realtime contract — delivering {@link CHAT_EVENTS.message} to the partner
 * and acknowledging the sender with {@link CHAT_EVENTS.ack}, or telling the
 * sender why the send was refused with {@link CHAT_EVENTS.sendFailed}. On
 * disconnect it does *not* end a live match outright: it opens a short reconnect
 * grace window (story 47) and arms a teardown timer, so a brief network blip
 * doesn't kill the chat; if the same session reconnects and sends
 * {@link CHAT_EVENTS.resume} in time, the match is restored. All match/chat
 * decisions live in the service; the gateway only owns the in-process timers.
 */
@WebSocketGateway({
  cors: { origin: webOrigins(), credentials: true },
})
export class ChatGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  /**
   * Pending grace-window teardown timers, keyed by match + the disconnected
   * participant. The timer fires the lapse once the grace window passes; a
   * reconnect clears it first. In-process by nature — the store keeps the
   * authoritative grace deadline so correctness never depends on a timer firing.
   */
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly chat: ChatService) {}

  @SubscribeMessage(CHAT_EVENTS.send)
  async handleSend(
    client: Socket,
    payload?: SendMessagePayload,
  ): Promise<void> {
    const identity = this.identityOf(client);
    if (!identity) {
      // No verified identity means the connection was never authenticated; refuse
      // rather than route, mirroring the matchmaking gateway's stance.
      this.fail(client, payload?.clientMessageId, "match_ended");
      return;
    }

    const result = await this.chat.send(identity, {
      text: payload?.text ?? "",
      clientMessageId: payload?.clientMessageId,
    });

    if (result.status === "no_active_match") {
      // The guardrail of story 43: the match has ended (or never existed), so the
      // message must not be delivered. Tell the sender so it stops retrying.
      this.fail(client, payload?.clientMessageId, "match_ended");
      return;
    }
    if (result.status === "invalid") {
      this.fail(client, payload?.clientMessageId, result.reason);
      return;
    }
    if (result.status === "spam") {
      // Story 45: URL-like message over the sender's link budget. Refuse it and
      // tell the sender to slow down rather than delivering link spam.
      this.fail(client, payload?.clientMessageId, "spam");
      return;
    }

    // Deliver to the partner, then acknowledge the sender with the server's id and
    // timestamp so the client can clear the message's pending/retry state.
    const delivery: ChatMessagePayload = {
      matchId: result.message.matchId,
      messageId: result.message.messageId,
      from: result.message.from,
      text: result.message.text,
      sentAt: result.message.sentAt,
    };
    this.server
      .to(result.recipientSocketId)
      .emit(CHAT_EVENTS.message, delivery);

    const ack: AckPayload = {
      clientMessageId: payload?.clientMessageId,
      messageId: result.message.messageId,
      sentAt: result.message.sentAt,
    };
    client.emit(CHAT_EVENTS.ack, ack);
  }

  /**
   * Relay a typing toggle to the partner, stamped with the typing user's role
   * and generated display name (story 40). An unauthenticated socket or one with
   * no active match is silently ignored — typing is presence, not a delivery, so
   * there is nothing to fail back to the sender. Crucially the sender is never
   * notified of anything in return, so this stays a one-way presence hint and
   * never a read receipt (story 41).
   */
  @SubscribeMessage(CHAT_EVENTS.typing)
  async handleTyping(client: Socket, payload?: TypingPayload): Promise<void> {
    const identity = this.identityOf(client);
    if (!identity) {
      return;
    }

    const result = await this.chat.typing(identity, payload?.isTyping === true);
    if (result.status !== "relay") {
      return;
    }

    const indicator: TypingIndicatorPayload = {
      matchId: result.matchId,
      from: result.from,
      displayName: result.displayName,
      isTyping: result.isTyping,
    };
    this.server.to(result.recipientSocketId).emit(CHAT_EVENTS.typing, indicator);
  }

  /**
   * Handle a socket dropping. Instead of ending a live match outright, open a
   * reconnect grace window (story 47): the partner is told to wait and a teardown
   * timer is armed for when the window lapses. Only when there is no one to wait
   * for (the partner was already away) does the match end now. The matchmaking
   * gateway separately frees any queue slot the same socket held; the two
   * disconnect handlers are independent, so a socket that was only queued is a
   * no-op here.
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const result = await this.chat.beginReconnectGrace(client.id);
    if (result.status === "none") {
      return;
    }
    if (result.status === "ended") {
      this.notifyEnded(result.ended);
      return;
    }

    // Held open for a reconnect: tell the partner to wait, and arm the teardown.
    const notice: PartnerDisconnectedPayload = {
      matchId: result.matchId,
      graceSeconds: productConfig.reconnectGraceSeconds,
    };
    this.server
      .to(result.partnerSocketId)
      .emit(CHAT_EVENTS.partnerDisconnected, notice);
    this.scheduleGraceTimeout(result.matchId, result.participantKey);
    this.logger.debug(
      `Match ${result.matchId} held for reconnect (${result.participantKey})`,
    );
  }

  /**
   * Resume the match a freshly reconnected socket's session was in (story 47).
   * The match is resolved from the socket's authenticated identity — never client
   * input — so only the same session can return. On success the pending teardown
   * timer is cancelled, the client is restored (role + recent buffer), and the
   * partner is told their stranger is back; otherwise the client is told there is
   * nothing to resume (and any lapsed match is reaped, notifying the partner).
   */
  @SubscribeMessage(CHAT_EVENTS.resume)
  async handleResume(client: Socket): Promise<void> {
    const identity = this.identityOf(client);
    if (!identity) {
      this.resumeFailed(client);
      return;
    }

    const result = await this.chat.resume(identity, client.id);
    if (result.status === "no_active_match") {
      if (result.ended) {
        this.notifyEnded(result.ended);
      }
      this.resumeFailed(client);
      return;
    }

    this.clearGraceTimer(
      this.graceTimerKey(result.matchId, chatIdentityKey(identity)),
    );

    const resumed: ResumedPayload = {
      matchId: result.matchId,
      role: result.role,
      partnerConnected: result.partnerConnected,
      buffer: result.buffer,
    };
    client.emit(CHAT_EVENTS.resumed, resumed);

    if (result.partnerSocketId) {
      const back: PartnerReconnectedPayload = { matchId: result.matchId };
      this.server
        .to(result.partnerSocketId)
        .emit(CHAT_EVENTS.partnerReconnected, back);
    }
  }

  /** Arm (replacing any prior) the teardown timer for a graced participant. */
  private scheduleGraceTimeout(matchId: string, participantKey: string): void {
    const key = this.graceTimerKey(matchId, participantKey);
    this.clearGraceTimer(key);
    const timer = setTimeout(() => {
      void this.fireGraceTimeout(matchId, participantKey, key);
    }, productConfig.reconnectGraceSeconds * 1000);
    // A pending grace timer must not keep the process alive on its own.
    timer.unref();
    this.graceTimers.set(key, timer);
  }

  /** End a match whose grace window lapsed, and tell the remaining partner. */
  private async fireGraceTimeout(
    matchId: string,
    participantKey: string,
    key: string,
  ): Promise<void> {
    this.graceTimers.delete(key);
    const ended = await this.chat.expireReconnectGrace(matchId, participantKey);
    if (ended) {
      this.notifyEnded(ended);
    }
  }

  private clearGraceTimer(key: string): void {
    const timer = this.graceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(key);
    }
  }

  private graceTimerKey(matchId: string, participantKey: string): string {
    return `${matchId}::${participantKey}`;
  }

  private resumeFailed(client: Socket): void {
    const payload: ResumeFailedPayload = { reason: "no_active_match" };
    client.emit(CHAT_EVENTS.resumeFailed, payload);
  }

  /** Fan a match-ended notice out to whichever participant(s) remain connected. */
  private notifyEnded(ended: EndedMatch): void {
    const payload: MatchEndedPayload = {
      matchId: ended.matchId,
      reason: ended.reason,
    };
    for (const socketId of ended.notifySocketIds) {
      this.server.to(socketId).emit(CHAT_EVENTS.matchEnded, payload);
    }
    this.logger.debug(`Ended match ${ended.matchId} (${ended.reason})`);
  }

  private fail(
    client: Socket,
    clientMessageId: string | undefined,
    reason: SendFailedPayload["reason"],
  ): void {
    const payload: SendFailedPayload = { clientMessageId, reason };
    client.emit(CHAT_EVENTS.sendFailed, payload);
  }

  private identityOf(client: Socket) {
    return (client.data as AuthenticatedSocketData).identity;
  }
}
