import { Logger } from "@nestjs/common";
import { OnGatewayConnection, WebSocketGateway } from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { webOrigins } from "../cors-origins";
import { RealtimeTokenService } from "./realtime-token.service";
import type { RealtimeIdentity } from "./realtime.types";

/** The verified identity stashed on an authenticated socket for later slices. */
export interface AuthenticatedSocketData {
  identity: RealtimeIdentity;
}

/**
 * The Socket.IO entry point. Its only job in this slice is authentication: every
 * connection must present a valid short-lived handshake token (minted by
 * `POST /realtime/token`). Verified connections get their {@link RealtimeIdentity}
 * attached to `socket.data` for matchmaking/chat/signaling slices to build on;
 * unauthenticated connections are told why and immediately disconnected, so no
 * realtime state is ever created for an unidentified client.
 */
@WebSocketGateway({
  cors: { origin: webOrigins(), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly tokens: RealtimeTokenService) {}

  handleConnection(client: Socket): void {
    const identity = this.tokens.verify(this.extractToken(client));
    if (!identity) {
      // Don't leak whether the token was missing, malformed, or expired.
      client.emit("auth_error", {
        message: "Invalid or expired realtime token.",
      });
      client.disconnect(true);
      return;
    }

    const data = client.data as AuthenticatedSocketData;
    data.identity = identity;
    this.logger.debug(
      `Realtime connection authenticated for ${identity.kind} ${identity.id}`,
    );
    client.emit("authenticated", { identity });
  }

  /**
   * Pull the handshake token from the Socket.IO `auth` payload
   * (`io(url, { auth: { token } })`), falling back to an `Authorization: Bearer`
   * header for non-browser clients.
   */
  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake?.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === "string") {
      return auth.token;
    }
    const header = client.handshake?.headers?.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length);
    }
    return undefined;
  }
}
