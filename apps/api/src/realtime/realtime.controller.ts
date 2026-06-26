import {
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import { USER_COOKIE_NAME } from "../auth/auth.types";
import { GuestSessionService } from "../session/guest-session.service";
import { GUEST_COOKIE_NAME } from "../session/session.types";
import { RealtimeTokenService } from "./realtime-token.service";
import type { RealtimeIdentity, RealtimeTokenResponse } from "./realtime.types";

/**
 * Issues the short-lived signed token a browser needs to open an authenticated
 * Socket.IO connection. The caller proves identity with the same HTTP-only
 * cookies used for the rest of the API — a logged-in app session (`fc_user`) or
 * an accepted guest session (`fc_guest`) — and gets back a handshake token
 * scoped to that identity. The realtime gateway verifies that token on connect.
 */
@Controller("realtime")
export class RealtimeController {
  constructor(
    private readonly tokens: RealtimeTokenService,
    private readonly auth: AuthService,
    private readonly guestSessions: GuestSessionService,
  ) {}

  /** Mint a handshake token for the current cookie identity, or 401 if none. */
  @Post("token")
  @HttpCode(200)
  async issueToken(@Req() req: Request): Promise<RealtimeTokenResponse> {
    const identity = await this.resolveIdentity(req);
    if (!identity) {
      throw new UnauthorizedException(
        "Confirm your age and accept the terms, or sign in, before connecting.",
      );
    }
    return this.tokens.issue(identity);
  }

  /**
   * Resolve the caller's realtime identity from their cookies. A logged-in
   * account takes precedence over a guest session so a signed-in user keeps
   * their durable identity even if a stale guest cookie is still present.
   */
  private async resolveIdentity(
    req: Request,
  ): Promise<RealtimeIdentity | null> {
    const userId = await this.auth.resolveUserId(
      req.cookies?.[USER_COOKIE_NAME],
    );
    if (userId) {
      return { kind: "user", id: userId };
    }
    const sessionId = await this.guestSessions.resolveSessionId(
      req.cookies?.[GUEST_COOKIE_NAME],
    );
    if (sessionId) {
      return { kind: "guest", id: sessionId };
    }
    return null;
  }
}
