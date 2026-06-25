import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type { Request, Response } from "express";
import { GuestSessionService } from "./guest-session.service";
import { GuestGuard } from "./guest.guard";
import type { RequestWithGuestSession } from "./guest.guard";
import { GUEST_COOKIE_NAME, GUEST_SESSION_TTL_SECONDS } from "./session.types";

interface AcceptLegalBody {
  ageConfirmed?: unknown;
  legalVersion?: unknown;
}

@Controller("session")
export class SessionController {
  constructor(private readonly guestSessions: GuestSessionService) {}

  /** Guest legal/age acceptance gate. Issues a signed, HTTP-only guest cookie. */
  @Post("guest/accept")
  @HttpCode(200)
  async acceptLegal(
    @Body() body: AcceptLegalBody,
    @Res({ passthrough: true }) res: Response
  ) {
    const { token, summary } = await this.guestSessions.accept({
      ageConfirmed: body?.ageConfirmed,
      legalVersion: body?.legalVersion
    });

    res.cookie(GUEST_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_SESSION_TTL_SECONDS * 1000
    });

    return summary;
  }

  /** Returns the current guest acceptance, or 401 if not yet accepted. */
  @Get("me")
  async me(@Req() req: Request) {
    const token = req.cookies?.[GUEST_COOKIE_NAME];
    const session = await this.guestSessions.getSession(token);
    if (!session) {
      throw new UnauthorizedException("No accepted guest session.");
    }
    return session;
  }

  /**
   * Placeholder protected route proving the gate is enforced server-side. The
   * matchmaking slice replaces this with real queue entry behind the same guard.
   */
  @Get("queue-eligibility")
  @UseGuards(GuestGuard)
  queueEligibility(@Req() req: RequestWithGuestSession) {
    return { eligible: true, legalVersion: req.guestSession?.legalVersion };
  }
}
