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
import { SafetyGuidelinesGuard } from "./safety-guidelines.guard";
import { GUEST_COOKIE_NAME, GUEST_SESSION_TTL_SECONDS } from "./session.types";

interface AcceptLegalBody {
  ageConfirmed?: unknown;
  legalVersion?: unknown;
}

interface AcceptSafetyBody {
  safetyVersion?: unknown;
}

interface ChangeDisplayNameBody {
  displayName?: unknown;
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
   * Records acceptance of the current safety guidelines for an existing session
   * (story 9). Requires the legal gate to have been passed first.
   */
  @Post("safety/accept")
  @HttpCode(200)
  @UseGuards(GuestGuard)
  async acceptSafety(@Body() body: AcceptSafetyBody, @Req() req: Request) {
    const token = req.cookies?.[GUEST_COOKIE_NAME];
    return this.guestSessions.acceptSafety(token, body?.safetyVersion);
  }

  /**
   * Changes the guest session's display name, once per day and after moderation
   * (stories 16-18). Requires an accepted legal gate.
   */
  @Post("username")
  @HttpCode(200)
  @UseGuards(GuestGuard)
  async changeDisplayName(@Body() body: ChangeDisplayNameBody, @Req() req: Request) {
    const token = req.cookies?.[GUEST_COOKIE_NAME];
    return this.guestSessions.changeDisplayName(token, body?.displayName);
  }

  /**
   * Flags the session to re-show the safety guidelines on the next visit, as
   * happens after an enforcement event (story 11). This is the hook the
   * moderation slice (#32) will call internally when it issues warnings/bans.
   */
  @Post("safety/reprompt")
  @HttpCode(200)
  @UseGuards(GuestGuard)
  async repromptSafety(@Req() req: Request) {
    const token = req.cookies?.[GUEST_COOKIE_NAME];
    return this.guestSessions.flagSafetyReprompt(token);
  }

  /**
   * Placeholder protected route proving the gate is enforced server-side. The
   * matchmaking slice replaces this with real queue entry behind the same guards.
   * Requires both the legal gate and the current safety guidelines.
   */
  @Get("queue-eligibility")
  @UseGuards(GuestGuard, SafetyGuidelinesGuard)
  queueEligibility(@Req() req: RequestWithGuestSession) {
    return { eligible: true, legalVersion: req.guestSession?.legalVersion };
  }
}
