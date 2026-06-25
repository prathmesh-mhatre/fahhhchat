import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { GuestSessionService } from "./guest-session.service";
import { GUEST_COOKIE_NAME } from "./session.types";
import type { GuestSessionSummary } from "./session.types";

export interface RequestWithGuestSession extends Request {
  guestSession?: GuestSessionSummary;
}

/**
 * Blocks access unless the request carries a valid, accepted guest session.
 * Applied to queue-eligibility now and reused by the matchmaking/socket slices
 * to enforce the "legal acceptance before queue entry" decision.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  constructor(private readonly guestSessions: GuestSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuestSession>();
    const token = request.cookies?.[GUEST_COOKIE_NAME];
    const session = await this.guestSessions.getSession(token);
    if (!session) {
      throw new UnauthorizedException("Confirm your age and accept the terms before continuing.");
    }
    request.guestSession = session;
    return true;
  }
}
