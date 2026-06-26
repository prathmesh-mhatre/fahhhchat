import { Logger } from "@nestjs/common";
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { webOrigins } from "../cors-origins";
import type { AuthenticatedSocketData } from "../realtime/realtime.gateway";
import { ChatService } from "./chat.service";
import {
  CHAT_EVENTS,
  type AckPayload,
  type ChatMessagePayload,
  type EndedMatch,
  type MatchEndedPayload,
  type SendFailedPayload,
  type SendMessagePayload,
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
 * disconnect it ends the sender's match and tells the partner the chat is over,
 * so no message is ever delivered after a match ends (story 43). All match/chat
 * decisions live in the service.
 */
@WebSocketGateway({
  cors: { origin: webOrigins(), credentials: true },
})
export class ChatGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

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
   * End the disconnecting socket's match, if it was in one, and tell the partner
   * the chat is over. The matchmaking gateway separately frees any queue slot the
   * same socket held; the two disconnect handlers are independent, so a socket
   * that was mid-chat ends its match here while one only queued is a no-op.
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const ended = await this.chat.endMatchForSocket(
      client.id,
      "partner_disconnected",
    );
    if (ended) {
      this.notifyEnded(ended);
    }
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
