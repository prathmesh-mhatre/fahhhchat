import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { generateDisplayIdentity } from "../identity/display-identity";
import { SESSION_STORE } from "./session.types";
import type {
  GuestSessionRecord,
  GuestSessionSummary,
  SafetyGuidelinesStatus,
  SessionStore
} from "./session.types";

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
      acceptedAt: new Date().toISOString(),
      identity: generateDisplayIdentity()
    };
    await this.store.save(record);

    return {
      token: this.sign(record.sessionId),
      summary: this.toSummary(record)
    };
  }

  /** Resolve the accepted session for a cookie value, or null if missing/invalid. */
  async getSession(token: string | undefined): Promise<GuestSessionSummary | null> {
    const record = await this.resolveRecord(token);
    return record ? this.toSummary(record) : null;
  }

  /**
   * Records acceptance of the current safety guidelines for an existing session.
   * Clears any enforcement-driven re-prompt flag. Re-prompting on a changed
   * version or after enforcement is handled by {@link safetyStatus}.
   */
  async acceptSafety(token: string | undefined, safetyVersion: unknown): Promise<GuestSessionSummary> {
    const record = await this.resolveRecord(token);
    if (!record) {
      throw new UnauthorizedException("Confirm your age and accept the terms before continuing.");
    }
    if (safetyVersion !== productConfig.safetyGuidelinesVersion) {
      throw new BadRequestException("The safety guidelines have changed. Please review and accept again.");
    }

    record.safetyGuidelinesVersion = productConfig.safetyGuidelinesVersion;
    record.safetyGuidelinesAcceptedAt = new Date().toISOString();
    record.safetyRepromptRequired = false;
    await this.store.save(record);

    return this.toSummary(record);
  }

  /**
   * Flags a session so the safety guidelines are shown again on the next visit,
   * regardless of version. Called after enforcement events (story 11). Exposed as
   * the hook the moderation slice (#32) will reuse.
   */
  async flagSafetyReprompt(token: string | undefined): Promise<GuestSessionSummary> {
    const record = await this.resolveRecord(token);
    if (!record) {
      throw new UnauthorizedException("Confirm your age and accept the terms before continuing.");
    }
    record.safetyRepromptRequired = true;
    await this.store.save(record);
    return this.toSummary(record);
  }

  /** Safety gate status for a cookie value, or null if there is no valid session. */
  async getSafetyStatus(token: string | undefined): Promise<SafetyGuidelinesStatus | null> {
    const record = await this.resolveRecord(token);
    return record ? this.safetyStatus(record) : null;
  }

  /**
   * Resolve the guest session id for a cookie value, but only when the session
   * still exists in the store, or null otherwise. Used by the realtime slice to
   * scope a Socket.IO handshake token to a real, accepted guest session.
   */
  async resolveSessionId(token: string | undefined): Promise<string | null> {
    const record = await this.resolveRecord(token);
    return record ? record.sessionId : null;
  }

  private async resolveRecord(token: string | undefined): Promise<GuestSessionRecord | null> {
    const sessionId = this.verify(token);
    if (!sessionId) {
      return null;
    }
    return this.store.get(sessionId);
  }

  private safetyStatus(record: GuestSessionRecord): SafetyGuidelinesStatus {
    const currentVersion = productConfig.safetyGuidelinesVersion;
    const acceptedVersion = record.safetyGuidelinesVersion ?? null;

    let reason: SafetyGuidelinesStatus["reason"] = null;
    if (record.safetyRepromptRequired) {
      reason = "enforcement";
    } else if (acceptedVersion === null) {
      reason = "first_time";
    } else if (acceptedVersion !== currentVersion) {
      reason = "version_changed";
    }

    return {
      required: reason !== null,
      currentVersion,
      acceptedVersion,
      reason
    };
  }

  private toSummary(record: GuestSessionRecord): GuestSessionSummary {
    return {
      accepted: true,
      legalVersion: record.legalVersion,
      acceptedAt: record.acceptedAt,
      identity: record.identity,
      safety: this.safetyStatus(record)
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
