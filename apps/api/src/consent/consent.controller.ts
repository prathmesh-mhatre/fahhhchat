import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ConsentService } from "./consent.service";
import { CONSENT_COOKIE_NAME, CONSENT_TTL_SECONDS } from "./consent.types";

interface DecideConsentBody {
  version?: unknown;
  analytics?: unknown;
}

@Controller("consent")
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /** Resolve the region from a header, falling back across the supported sources. */
  private regionFor(req: Request): string {
    return this.consent.resolveRegion({
      override: header(req, "x-country"),
      cfIpCountry: header(req, "cf-ipcountry"),
      vercelIpCountry: header(req, "x-vercel-ip-country")
    });
  }

  /**
   * Current cookie/privacy consent state for the visitor. No guard: consent is
   * resolved for any visitor (essential behavior is allowed before any decision).
   */
  @Get()
  status(@Req() req: Request) {
    const region = this.regionFor(req);
    const cookie = req.cookies?.[CONSENT_COOKIE_NAME];
    return this.consent.status(region, cookie);
  }

  /** Record the visitor's analytics opt-in/opt-out and persist a signed cookie. */
  @Post()
  @HttpCode(200)
  decide(
    @Body() body: DecideConsentBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const region = this.regionFor(req);
    const { cookieValue, status } = this.consent.decide(region, body?.version, body?.analytics);

    res.cookie(CONSENT_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CONSENT_TTL_SECONDS * 1000
    });

    return status;
  }
}

/** Express lowercases header names; tolerate string[] values from duplicates. */
function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
