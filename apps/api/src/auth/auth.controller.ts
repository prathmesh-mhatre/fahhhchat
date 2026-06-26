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
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { USER_COOKIE_NAME, USER_SESSION_TTL_SECONDS } from "./auth.types";

interface GoogleLoginBody {
  idToken?: unknown;
}

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

interface ChangeAvatarBody {
  avatarId?: unknown;
  backgroundColor?: unknown;
}

interface SavePreferencesBody {
  matchingLanguage?: unknown;
  gender?: unknown;
  uiLanguage?: unknown;
  genderFilter?: unknown;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Exchanges a verified Google ID token (obtained by NextAuth in the web app)
   * for an internal user and a backend app session, set as an HTTP-only cookie.
   * The response never includes Google identity — only the internal summary.
   */
  @Post("google")
  @HttpCode(200)
  async login(@Body() body: GoogleLoginBody, @Res({ passthrough: true }) res: Response) {
    const { token, summary } = await this.auth.loginWithGoogle(body?.idToken);
    this.setSessionCookie(res, token);
    return summary;
  }

  /** Returns the current logged-in user, or 401 if not signed in. */
  @Get("me")
  async me(@Req() req: Request) {
    const token = req.cookies?.[USER_COOKIE_NAME];
    const user = await this.auth.getUser(token);
    if (!user) {
      throw new UnauthorizedException("Not signed in.");
    }
    return user;
  }

  /** Persists the account's 18+/legal acceptance (story 22). */
  @Post("legal/accept")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async acceptLegal(@Body() body: AcceptLegalBody, @Req() req: Request) {
    const token = req.cookies?.[USER_COOKIE_NAME];
    return this.auth.acceptLegal(token, body?.ageConfirmed, body?.legalVersion);
  }

  /** Persists the account's acceptance of the current safety guidelines. */
  @Post("safety/accept")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async acceptSafety(@Body() body: AcceptSafetyBody, @Req() req: Request) {
    const token = req.cookies?.[USER_COOKIE_NAME];
    return this.auth.acceptSafety(token, body?.safetyVersion);
  }

  /**
   * Changes the account's display name, once per day and after moderation
   * (stories 16-18). The cooldown persists with the account.
   */
  @Post("username")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async changeDisplayName(@Body() body: ChangeDisplayNameBody, @Req() req: Request) {
    const token = req.cookies?.[USER_COOKIE_NAME];
    return this.auth.changeDisplayName(token, body?.displayName);
  }

  /**
   * Changes the account's avatar to another entry from the safe built-in set,
   * once per day (stories 19-21). The cooldown persists with the account.
   */
  @Post("avatar")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async changeAvatar(@Body() body: ChangeAvatarBody, @Req() req: Request) {
    const token = req.cookies?.[USER_COOKIE_NAME];
    return this.auth.changeAvatar(token, body?.avatarId, body?.backgroundColor);
  }

  /**
   * Saves the account's matching language and gender (and optional separate UI
   * language and gender filter) for lightweight onboarding or a later preference
   * edit (stories 27-31). The server validates against the supported sets.
   */
  @Post("preferences")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async savePreferences(@Body() body: SavePreferencesBody, @Req() req: Request) {
    const token = req.cookies?.[USER_COOKIE_NAME];
    return this.auth.setPreferences(
      token,
      body?.matchingLanguage,
      body?.gender,
      body?.uiLanguage,
      body?.genderFilter
    );
  }

  /** Clears the app session cookie (logout). */
  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(USER_COOKIE_NAME, { path: "/" });
    return { loggedIn: false };
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(USER_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: USER_SESSION_TTL_SECONDS * 1000
    });
  }
}
