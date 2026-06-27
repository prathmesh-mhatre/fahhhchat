import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AdminGuard, type RequestWithAdmin } from "./admin.guard";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  /**
   * Minimal protected admin endpoint that proves the slice end-to-end: it returns
   * 200 with the caller's resolved role only for an allowlisted admin, and the
   * {@link AdminGuard} rejects everyone else (anonymous or a normal Google user)
   * with 403 before this handler runs. The later admin slices — report review
   * (#35), enforcement (#36), feature-flag management (#37) — hang their routes
   * off this same guard. The response carries the internal role, never the
   * admin's Google email.
   */
  @Get("me")
  me(@Req() req: RequestWithAdmin) {
    return { isAdmin: true, role: req.admin?.role };
  }
}
