import { createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { OPT_IN_REGIONS } from "./consent.types";
import type {
  ConsentCategory,
  ConsentDecision,
  ConsentRegime,
  ConsentStatus
} from "./consent.types";

export interface DecideConsentResult {
  /** Signed value to store in the consent cookie. */
  cookieValue: string;
  status: ConsentStatus;
}

/**
 * Owns the region-aware cookie/privacy consent gate (issue #7). Kept
 * framework-light — it works on primitive header/cookie values rather than the
 * Express request — so the region resolution, regime defaults, version
 * re-acceptance, and the essential-vs-analytics separation can be unit tested
 * in isolation (see PRD testing notes on isolating legal/privacy behavior).
 */
@Injectable()
export class ConsentService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET must be set to sign consent cookies");
    }
    this.secret = secret;
  }

  /**
   * Resolve the visitor's country from CDN/proxy headers. `x-country` is an
   * explicit override useful in local dev and tests; in production the value
   * comes from the edge (`cf-ipcountry` on Cloudflare, `x-vercel-ip-country` on
   * Vercel). Returns an uppercase ISO code, or "unknown" if undetectable.
   */
  resolveRegion(headers: {
    cfIpCountry?: string;
    vercelIpCountry?: string;
    override?: string;
  }): string {
    const raw = headers.override ?? headers.cfIpCountry ?? headers.vercelIpCountry ?? "";
    const code = raw.trim().toUpperCase();
    // Cloudflare uses "XX"/"T1" for unknown/Tor; treat non 2-letter codes as unknown.
    if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") {
      return "unknown";
    }
    return code;
  }

  /**
   * Opt-in regions require explicit analytics consent. An undetectable region
   * is treated as opt-in (privacy-first default).
   */
  regimeFor(region: string): ConsentRegime {
    if (region === "unknown") {
      return "opt_in";
    }
    return OPT_IN_REGIONS.has(region) ? "opt_in" : "opt_out";
  }

  /** Build the consent status for a visitor from their region and cookie value. */
  status(region: string, cookieValue: string | undefined): ConsentStatus {
    const regime = this.regimeFor(region);
    const decision = this.verify(cookieValue);
    const currentVersion = productConfig.consentVersion;

    // A decision under the current policy version is honored. A decision from an
    // older version is stale: re-prompt and fall back to the regime default.
    if (decision && decision.version === currentVersion) {
      return {
        version: currentVersion,
        region,
        regime,
        essential: true,
        analytics: decision.analytics,
        required: false,
        decidedAt: decision.decidedAt
      };
    }

    return {
      version: currentVersion,
      region,
      regime,
      essential: true,
      // Opt-out regions allow analytics under implied consent until the visitor
      // opts out; opt-in regions keep it off until explicit opt-in.
      analytics: regime === "opt_out",
      required: true,
      decidedAt: null
    };
  }

  /** Record an analytics opt-in/opt-out decision and return the signed cookie + status. */
  decide(region: string, version: unknown, analytics: unknown): DecideConsentResult {
    if (version !== productConfig.consentVersion) {
      throw new BadRequestException(
        "The privacy/cookie policy has changed. Please review and choose again."
      );
    }
    if (typeof analytics !== "boolean") {
      throw new BadRequestException("Specify whether analytics is allowed.");
    }

    const decision: ConsentDecision = {
      version: productConfig.consentVersion,
      analytics,
      decidedAt: new Date().toISOString()
    };

    return {
      cookieValue: this.sign(decision),
      status: {
        version: decision.version,
        region,
        regime: this.regimeFor(region),
        essential: true,
        analytics: decision.analytics,
        required: false,
        decidedAt: decision.decidedAt
      }
    };
  }

  /**
   * Whether an event in the given category may be emitted for this visitor.
   * Essential events are always allowed (even before any consent decision);
   * analytics events require the visitor's effective opt-in. This is the hook
   * the in-house analytics tracker (issue #48) consults before recording.
   */
  isAllowed(status: ConsentStatus, category: ConsentCategory): boolean {
    if (category === "essential") {
      return true;
    }
    return status.analytics;
  }

  private sign(decision: ConsentDecision): string {
    const payload = Buffer.from(JSON.stringify(decision)).toString("base64url");
    return `${payload}.${this.signature(payload)}`;
  }

  /** Verify the HMAC and return the embedded decision, or null if missing/tampered. */
  private verify(cookieValue: string | undefined): ConsentDecision | null {
    if (!cookieValue) {
      return null;
    }
    const lastDot = cookieValue.lastIndexOf(".");
    if (lastDot <= 0) {
      return null;
    }
    const payload = cookieValue.slice(0, lastDot);
    const provided = cookieValue.slice(lastDot + 1);
    const expected = this.signature(payload);

    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      return null;
    }

    try {
      return JSON.parse(Buffer.from(payload, "base64url").toString()) as ConsentDecision;
    } catch {
      return null;
    }
  }

  private signature(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}
