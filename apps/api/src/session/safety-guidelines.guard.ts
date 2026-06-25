import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { GuestSessionService } from "./guest-session.service";
import { GUEST_COOKIE_NAME } from "./session.types";
import type { SafetyGuidelinesStatus } from "./session.types";
import type { RequestWithGuestSession } from "./guest.guard";

export interface RequestWithSafetyStatus extends RequestWithGuestSession {
  safetyStatus?: SafetyGuidelinesStatus;
}

/**
 * Blocks access unless the request carries a session that has accepted the
 * current safety guidelines. Enforces "see concise safety guidelines before the
 * first chat" (story 9) server-side, alongside the legal {@link GuestGuard}.
 */
@Injectable()
export class SafetyGuidelinesGuard implements CanActivate {
  constructor(private readonly guestSessions: GuestSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSafetyStatus>();
    const token = request.cookies?.[GUEST_COOKIE_NAME];
    const status = await this.guestSessions.getSafetyStatus(token);
    if (!status || status.required) {
      throw new ForbiddenException("Review and accept the current safety guidelines before continuing.");
    }
    request.safetyStatus = status;
    return true;
  }
}
