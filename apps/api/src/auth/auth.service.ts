import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import type { SafetyGuidelinesStatus } from "../session/session.types";
import {
  GOOGLE_TOKEN_VERIFIER,
  USER_STORE,
  type LegalAcceptanceStatus,
  type UserRecord,
  type UserStore,
  type UserSummary
} from "./auth.types";
import type { GoogleTokenVerifier } from "./google-token-verifier";

export interface LoginResult {
  token: string;
  summary: UserSummary;
}

/**
 * Owns logged-in identity: turns a verified Google token into a durable,
 * pseudonymous internal user, persists legal/safety acceptance to that account,
 * and mints/verifies the HMAC-signed app session token the backend trusts for
 * API and (later) Socket.IO access. Google identity (`sub`/`email`) is kept on
 * the record for internal use but never surfaced in {@link UserSummary}.
 */
@Injectable()
export class AuthService {
  private readonly secret: string;

  constructor(
    @Inject(USER_STORE) private readonly store: UserStore,
    @Inject(GOOGLE_TOKEN_VERIFIER) private readonly googleVerifier: GoogleTokenVerifier
  ) {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET must be set to sign app session tokens");
    }
    this.secret = secret;
  }

  /**
   * Verifies a Google ID token and upserts the matching internal user. Existing
   * accounts are matched by Google subject so the same person keeps their
   * internal id (and persisted preferences/acceptance) across logins (story 22).
   */
  async loginWithGoogle(idToken: unknown): Promise<LoginResult> {
    if (typeof idToken !== "string" || idToken.length === 0) {
      throw new BadRequestException("A Google identity token is required.");
    }
    const identity = await this.googleVerifier.verify(idToken);

    const now = new Date().toISOString();
    const existing = await this.store.findByGoogleSub(identity.sub);
    const record: UserRecord = existing
      ? { ...existing, email: identity.email, lastLoginAt: now }
      : {
          userId: randomUUID(),
          googleSub: identity.sub,
          email: identity.email,
          createdAt: now,
          lastLoginAt: now
        };
    await this.store.save(record);

    return { token: this.sign(record.userId), summary: this.toSummary(record) };
  }

  /** Resolve the user summary for an app token, or null if missing/invalid. */
  async getUser(token: string | undefined): Promise<UserSummary | null> {
    const record = await this.resolveRecord(token);
    return record ? this.toSummary(record) : null;
  }

  /**
   * Resolve the internal user id for a valid app token, but only when the
   * account still exists, or null otherwise. Used by the realtime slice to scope
   * a Socket.IO handshake token to a real logged-in account.
   */
  async resolveUserId(token: string | undefined): Promise<string | null> {
    const record = await this.resolveRecord(token);
    return record ? record.userId : null;
  }

  /** Persist the account's legal/age acceptance (story 22). */
  async acceptLegal(token: string | undefined, ageConfirmed: unknown, legalVersion: unknown): Promise<UserSummary> {
    const record = await this.requireRecord(token);
    if (ageConfirmed !== true) {
      throw new BadRequestException("You must confirm that you are 18 or older.");
    }
    if (legalVersion !== productConfig.legalVersion) {
      throw new BadRequestException("The legal terms have changed. Please review and accept again.");
    }
    record.legalVersion = productConfig.legalVersion;
    record.ageConfirmed = true;
    record.legalAcceptedAt = new Date().toISOString();
    await this.store.save(record);
    return this.toSummary(record);
  }

  /** Persist acceptance of the current safety guidelines for the account. */
  async acceptSafety(token: string | undefined, safetyVersion: unknown): Promise<UserSummary> {
    const record = await this.requireRecord(token);
    if (safetyVersion !== productConfig.safetyGuidelinesVersion) {
      throw new BadRequestException("The safety guidelines have changed. Please review and accept again.");
    }
    record.safetyGuidelinesVersion = productConfig.safetyGuidelinesVersion;
    record.safetyGuidelinesAcceptedAt = new Date().toISOString();
    record.safetyRepromptRequired = false;
    await this.store.save(record);
    return this.toSummary(record);
  }

  /** Flag the account to re-show safety guidelines next visit (enforcement hook). */
  async flagSafetyReprompt(token: string | undefined): Promise<UserSummary> {
    const record = await this.requireRecord(token);
    record.safetyRepromptRequired = true;
    await this.store.save(record);
    return this.toSummary(record);
  }

  /** Verify the app token's HMAC and return the embedded user id, or null. */
  verify(token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const lastDot = token.lastIndexOf(".");
    if (lastDot <= 0) {
      return null;
    }
    const userId = token.slice(0, lastDot);
    const provided = Buffer.from(token.slice(lastDot + 1));
    const expected = Buffer.from(this.signature(userId));
    if (provided.length !== expected.length) {
      return null;
    }
    return timingSafeEqual(provided, expected) ? userId : null;
  }

  private async resolveRecord(token: string | undefined): Promise<UserRecord | null> {
    const userId = this.verify(token);
    return userId ? this.store.get(userId) : null;
  }

  private async requireRecord(token: string | undefined): Promise<UserRecord> {
    const record = await this.resolveRecord(token);
    if (!record) {
      throw new UnauthorizedException("Sign in to continue.");
    }
    return record;
  }

  private toSummary(record: UserRecord): UserSummary {
    return {
      loggedIn: true,
      userId: record.userId,
      legal: this.legalStatus(record),
      safety: this.safetyStatus(record)
    };
  }

  private legalStatus(record: UserRecord): LegalAcceptanceStatus {
    const acceptedVersion = record.legalVersion ?? null;
    return {
      required: acceptedVersion !== productConfig.legalVersion,
      currentVersion: productConfig.legalVersion,
      acceptedVersion
    };
  }

  private safetyStatus(record: UserRecord): SafetyGuidelinesStatus {
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
    return { required: reason !== null, currentVersion, acceptedVersion, reason };
  }

  private sign(userId: string): string {
    return `${userId}.${this.signature(userId)}`;
  }

  private signature(userId: string): string {
    return createHmac("sha256", this.secret).update(`user:${userId}`).digest("base64url");
  }
}
