import { Logger } from "@nestjs/common";
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { resolveLanguage } from "@fahhhchat/config";
import { AuthService } from "../auth/auth.service";
import { ChatService } from "../chat/chat.service";
import { webOrigins } from "../cors-origins";
import type { AuthenticatedSocketData } from "../realtime/realtime.gateway";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import { MatchmakingService } from "./matchmaking.service";
import {
  MATCHMAKING_EVENTS,
  type JoinPreferences,
  type Match,
  type MatchFoundPayload,
  type RateLimitedPayload,
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

  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly auth: AuthService,
    private readonly chat: ChatService
  ) {}

  @SubscribeMessage(MATCHMAKING_EVENTS.join)
  async handleJoin(
    client: Socket,
    payload?: { language?: unknown }
  ): Promise<void> {
    const identity = this.identityOf(client);
    if (!identity) {
      client.emit(MATCHMAKING_EVENTS.error, {
        message: "Not authenticated for realtime.",
      });
      return;
    }

    // The client carries its own matching-language preference (a guest's
    // browser-seeded language or a logged-in user's declared one). Normalize to
    // a supported code here so an unsupported or missing value just falls back
    // to the default rather than skewing matching (stories 26-28, 36).
    const language = resolveLanguage(payload?.language);
    const prefs = await this.resolvePreferences(identity, language);
    const result = await this.matchmaking.join(identity, client.id, prefs);
    if (result.status === "rate_limited") {
      // Throttled (stories 142-144): tell the client how long to wait rather
      // than appearing to hang. Distinct from the generic error so the web app
      // can show a "slow down" hint and disable Join for the cooldown.
      const payload: RateLimitedPayload = {
        retryAfterSeconds: result.retryAfterSeconds,
      };
      client.emit(MATCHMAKING_EVENTS.rateLimited, payload);
      return;
    }
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
    await this.announceMatch(result.match);
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

  /**
   * Register the pair with the chat layer, then tell each side of the new match,
   * with their own role, by socket id. Registration happens *before* the
   * `match:found` fan-out so the active match already exists when a client sends
   * its first message on receiving the event — no send can race ahead of routing.
   */
  private async announceMatch(match: Match): Promise<void> {
    await this.chat.registerMatch(match);
    // Each side learns only whether *the other* is a logged-in account — the
    // single bit the chat client needs to gate post-match camera media (#38,
    // story 97). A logged-in identity is `kind: "user"`; everything else (a
    // guest session) is not. No id or profile detail crosses over.
    const initiatorLoggedIn = match.initiator.identity.kind === "user";
    const responderLoggedIn = match.responder.identity.kind === "user";
    const toInitiator: MatchFoundPayload = {
      matchId: match.matchId,
      role: "initiator",
      partnerLoggedIn: responderLoggedIn,
    };
    const toResponder: MatchFoundPayload = {
      matchId: match.matchId,
      role: "responder",
      partnerLoggedIn: initiatorLoggedIn,
    };
    this.server.to(match.initiator.socketId).emit(MATCHMAKING_EVENTS.matchFound, toInitiator);
    this.server.to(match.responder.socketId).emit(MATCHMAKING_EVENTS.matchFound, toResponder);
    this.logger.debug(`Created match ${match.matchId}`);
  }

  /**
   * Resolve the joiner's soft matching preferences. Language is client-supplied
   * (it only steers who they meet). Gender filtering is *logged-in only* (story
   * 30) and read from the stored account, never the client, so a user can't spoof
   * the declared gender others filter on; guests carry no gender and no filter.
   */
  private async resolvePreferences(
    identity: RealtimeIdentity,
    language: ReturnType<typeof resolveLanguage>
  ): Promise<JoinPreferences> {
    if (identity.kind !== "user") {
      return { language };
    }
    const { gender, genderFilter } = await this.auth.getMatchPreferences(
      identity.id
    );
    return { language, gender, genderFilter };
  }

  private identityOf(client: Socket) {
    return (client.data as AuthenticatedSocketData).identity;
  }
}
