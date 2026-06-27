import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { USER_COOKIE_NAME } from "../auth/auth.types";
import { AdminService } from "./admin.service";
import type { AdminContext } from "./admin.types";

export interface RequestWithAdmin extends Request {
  admin?: AdminContext;
}

/**
 * Gates admin-only endpoints (story 82): a request passes only when it carries a
 * valid Google-authenticated app session (the backend-minted `fc_user` cookie)
 * **and** the account behind it holds a database admin role. A non-admin Google
 * user — the common case — is rejected with 403, deliberately the same response
 * as an anonymous request so the endpoint never reveals that an admin surface
 * even exists. The resolved {@link AdminContext} is attached to the request for
 * the handler (and the later report-review/enforcement slices that build on it).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly admin: AdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    const token = request.cookies?.[USER_COOKIE_NAME];
    const admin = await this.admin.resolveAdmin(token);
    if (!admin) {
      throw new ForbiddenException("Admin access required.");
    }
    request.admin = admin;
    return true;
  }
}
