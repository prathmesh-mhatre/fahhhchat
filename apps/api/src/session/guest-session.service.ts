import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { SESSION_STORE } from "./session.types";
import type { GuestSessionRecord, GuestSessionSummary, SessionStore } from "./session.types";

export interface AcceptLegalInput {
  ageConfirmed: unknown;
  legalVersion: unknown;
}

export interface AcceptLegalResult {
  token: string;
  summary: GuestSessionSummary;
}

/**
 * Owns the guest legal/age acceptance gate: validates the submission, persists
 * the acceptance to the session store, and mints/verifies the signed session
 * handle carried in the guest cookie. Kept framework-light so the validation
 * and token contract can be unit tested in isolation (see PRD testing notes on
 * isolating legal acceptance).
 */
@Injectable()
export class GuestSessionService {
  private readonly secret: string;

  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET must be set to sign guest session cookies");
    }
    this.secret = secret;
  }

  async accept(input: AcceptLegalInput): Promise<AcceptLegalResult> {
    if (input.ageConfirmed !== true) {
      throw new BadRequestException("You must confirm that you are 18 or older.");
    }
    if (input.legalVersion !== productConfig.legalVersion) {
      throw new BadRequestException("The legal terms have changed. Please review and accept again.");
    }

    const record: GuestSessionRecord = {
      sessionId: randomUUID(),
      legalVersion: productConfig.legalVersion,
      ageConfirmed: true,
      acceptedAt: new Date().toISOString()
    };
    await this.store.save(record);

    return {
      token: this.sign(record.sessionId),
      summary: this.toSummary(record)
    };
  }

  /** Resolve the accepted session for a cookie value, or null if missing/invalid. */
  async getSession(token: string | undefined): Promise<GuestSessionSummary | null> {
    const sessionId = this.verify(token);
    if (!sessionId) {
      return null;
    }
    const record = await this.store.get(sessionId);
    if (!record) {
      return null;
    }
    return this.toSummary(record);
  }

  private toSummary(record: GuestSessionRecord): GuestSessionSummary {
    return {
      accepted: true,
      legalVersion: record.legalVersion,
      acceptedAt: record.acceptedAt
    };
  }

  private sign(sessionId: string): string {
    return `${sessionId}.${this.signature(sessionId)}`;
  }

  /** Verify the HMAC and return the embedded session id, or null if tampered. */
  verify(token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const lastDot = token.lastIndexOf(".");
    if (lastDot <= 0) {
      return null;
    }
    const sessionId = token.slice(0, lastDot);
    const provided = token.slice(lastDot + 1);
    const expected = this.signature(sessionId);

    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) {
      return null;
    }
    return timingSafeEqual(providedBuf, expectedBuf) ? sessionId : null;
  }

  private signature(sessionId: string): string {
    return createHmac("sha256", this.secret).update(sessionId).digest("base64url");
  }
}
