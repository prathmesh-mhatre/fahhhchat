import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "../auth/auth.service";
import { USER_COOKIE_NAME } from "../auth/auth.types";
import { RateLimitService } from "../rate-limit/rate-limit.service";
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
    private readonly rateLimits: RateLimitService,
  ) {}

  /**
   * Mint a handshake token for the current cookie identity, or 401 if none.
   *
   * Each socket (re)connect needs a fresh token, so this endpoint is the natural
   * choke point for the reconnect throttle (story 144): a client that loops
   * through reconnects — or a bot minting tokens to flood realtime — is capped
   * per identity, stricter for guests than logged-in users (stories 142-143).
   * A throttled caller gets a 429 with a `Retry-After` header rather than a
   * token. The legitimate reconnect-grace flow (#25) reconnects far below this
   * ceiling, so ordinary users never see it.
   */
  @Post("token")
  @HttpCode(200)
  async issueToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RealtimeTokenResponse> {
    const identity = await this.resolveIdentity(req);
    if (!identity) {
      throw new UnauthorizedException(
        "Confirm your age and accept the terms, or sign in, before connecting.",
      );
    }

    const decision = await this.rateLimits.consume("reconnect", identity);
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many connection attempts. Please slow down.",
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
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
