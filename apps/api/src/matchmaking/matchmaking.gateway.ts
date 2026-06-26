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
import { MatchmakingService } from "./matchmaking.service";
import {
  MATCHMAKING_EVENTS,
  type Match,
  type MatchFoundPayload,
} from "./matchmaking.types";

/**
 * Socket.IO surface for the shared matching pool. It rides the same server and
 * namespace as {@link import("../realtime/realtime.gateway").RealtimeGateway},
 * which authenticated the connection and stashed the verified
 * {@link import("../realtime/realtime.types").RealtimeIdentity} on
 * `socket.data`; this gateway only handles queue messages, so an unauthenticated
 * socket (no identity) is refused here too.
 *
 * Matching logic lives in {@link MatchmakingService}; the gateway's job is just
 * to translate socket messages into service calls and fan the result out to the
 * right socket(s) — notifying *both* sides of a new match by their socket id.
 */
@WebSocketGateway({
  cors: { origin: webOrigins(), credentials: true },
})
export class MatchmakingGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(MatchmakingGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly matchmaking: MatchmakingService) {}

  @SubscribeMessage(MATCHMAKING_EVENTS.join)
  async handleJoin(client: Socket): Promise<void> {
    const identity = this.identityOf(client);
    if (!identity) {
      client.emit(MATCHMAKING_EVENTS.error, {
        message: "Not authenticated for realtime.",
      });
      return;
    }

    const result = await this.matchmaking.join(identity, client.id);
    if (result.status === "unavailable") {
      client.emit(MATCHMAKING_EVENTS.error, {
        message: "Matching is temporarily unavailable. Please try again later.",
      });
      return;
    }
    if (result.status === "queued") {
      client.emit(MATCHMAKING_EVENTS.waiting, {});
      return;
    }
    this.announceMatch(result.match);
  }

  @SubscribeMessage(MATCHMAKING_EVENTS.leave)
  async handleLeave(client: Socket): Promise<void> {
    const identity = this.identityOf(client);
    if (identity) {
      await this.matchmaking.leave(identity);
    }
    client.emit(MATCHMAKING_EVENTS.left, {});
  }

  /** Free the queue slot a dropped socket held so the pool has no dead waiters. */
  async handleDisconnect(client: Socket): Promise<void> {
    await this.matchmaking.handleDisconnect(client.id);
  }

  /** Tell each side of a new match, with their own role, by socket id. */
  private announceMatch(match: Match): void {
    const toInitiator: MatchFoundPayload = {
      matchId: match.matchId,
      role: "initiator",
    };
    const toResponder: MatchFoundPayload = {
      matchId: match.matchId,
      role: "responder",
    };
    this.server.to(match.initiator.socketId).emit(MATCHMAKING_EVENTS.matchFound, toInitiator);
    this.server.to(match.responder.socketId).emit(MATCHMAKING_EVENTS.matchFound, toResponder);
    this.logger.debug(`Created match ${match.matchId}`);
  }

  private identityOf(client: Socket) {
    return (client.data as AuthenticatedSocketData).identity;
  }
}
