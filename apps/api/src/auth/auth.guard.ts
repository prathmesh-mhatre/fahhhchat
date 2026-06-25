import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { USER_COOKIE_NAME, type UserSummary } from "./auth.types";

export interface RequestWithUser extends Request {
  user?: UserSummary;
}

/**
 * Blocks access unless the request carries a valid app session token (the
 * backend-minted `fc_user` cookie). This is the "backend verifies an app
 * session identity" contract the realtime/API slices build on.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = request.cookies?.[USER_COOKIE_NAME];
    const user = await this.auth.getUser(token);
    if (!user) {
      throw new UnauthorizedException("Sign in to continue.");
    }
    request.user = user;
    return true;
  }
}
