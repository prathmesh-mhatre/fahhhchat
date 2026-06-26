import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  defaultGenderFilter,
  defaultLanguage,
  isGenderFilter,
  isLanguageCode,
  isUserGender,
  productConfig,
  resolveAvatarSelection,
  type GenderFilter,
  type OnboardingStatus,
  type UserGender,
  type UserPreferences
} from "@fahhhchat/config";
import { generateDisplayIdentity } from "../identity/display-identity";
import { avatarChangeStatus } from "../identity/avatar-change";
import { displayNameChangeStatus } from "../identity/display-name-change";
import { moderateDisplayName } from "../identity/username-moderation";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
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
    @Inject(GOOGLE_TOKEN_VERIFIER) private readonly googleVerifier: GoogleTokenVerifier,
    private readonly flags: FeatureFlagsService
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
      ? // Keep the existing generated identity stable across logins (story 22),
        // but backfill it for accounts created before this slice.
        { ...existing, email: identity.email, lastLoginAt: now, identity: existing.identity ?? generateDisplayIdentity() }
      : {
          userId: randomUUID(),
          googleSub: identity.sub,
          email: identity.email,
          createdAt: now,
          lastLoginAt: now,
          identity: generateDisplayIdentity()
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
   * The matching-relevant preferences for a logged-in user id: their declared
   * gender (what others filter on) and their own gender filter. Read off the
   * stored account — never client-asserted — so the matchmaking gateway can
   * apply a strong gender preference (stories 30-32) it can trust. Falls back to
   * "no preference" (null gender, "both" filter) for an unknown id, an account
   * that hasn't onboarded, or one that has since been removed.
   */
  async getMatchPreferences(
    userId: string
  ): Promise<{ gender: UserGender | null; genderFilter: GenderFilter }> {
    const record = await this.store.get(userId);
    return {
      gender: record?.gender ?? null,
      genderFilter: record?.genderFilter ?? defaultGenderFilter
    };
  }

  /**
   * The account's generated display name by internal user id, or null when the
   * account is unknown or has no identity yet. Read off the stored account (never
   * client-asserted) so the chat layer can attach a *server-authoritative* name
   * to a logged-in user's typing indicator (story 40) — a user can never spoof
   * the name a stranger sees.
   */
  async getDisplayName(userId: string): Promise<string | null> {
    const record = await this.store.get(userId);
    return record?.identity?.displayName ?? null;
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

  /**
   * Changes the account's display name (story 16). Enforces the once-per-day
   * cooldown and moderates the proposed name before saving (stories 17-18). The
   * cooldown timestamp persists on the account, so it survives logout/login.
   */
  async changeDisplayName(token: string | undefined, rawName: unknown): Promise<UserSummary> {
    const record = await this.requireRecord(token);

    if (!displayNameChangeStatus(record.displayNameUpdatedAt).allowed) {
      throw new ConflictException("You can only change your name once a day. Try again later.");
    }

    const result = moderateDisplayName(rawName);
    if (!result.ok) {
      throw new BadRequestException(result.message);
    }

    record.identity = { ...(record.identity ?? generateDisplayIdentity()), displayName: result.value };
    record.displayNameUpdatedAt = new Date().toISOString();
    await this.store.save(record);
    return this.toSummary(record);
  }

  /**
   * Changes the account's avatar to another entry from the safe built-in set
   * (story 19). Enforces the once-per-day cooldown and validates the selection
   * against the allow-list — no uploads (story 20). The cooldown timestamp
   * persists on the account, so it survives logout/login (story 21).
   */
  async changeAvatar(
    token: string | undefined,
    rawAvatarId: unknown,
    rawBackgroundColor: unknown
  ): Promise<UserSummary> {
    const record = await this.requireRecord(token);

    if (!avatarChangeStatus(record.avatarUpdatedAt).allowed) {
      throw new ConflictException("You can only change your avatar once a day. Try again later.");
    }

    const avatar = resolveAvatarSelection(rawAvatarId, rawBackgroundColor);
    if (!avatar) {
      throw new BadRequestException("Choose an avatar from the built-in set.");
    }

    record.identity = { ...(record.identity ?? generateDisplayIdentity()), avatar };
    record.avatarUpdatedAt = new Date().toISOString();
    await this.store.save(record);
    return this.toSummary(record);
  }

  /**
   * Saves the account's matching language and gender, and optionally a separate
   * UI language and gender filter (stories 27-31). Used both for the initial
   * lightweight onboarding step and for later preference edits — once matching
   * language and gender are set, {@link OnboardingStatus.required} flips to
   * false. UI and matching language are stored as distinct fields so they can
   * diverge later; the gender filter is captured here but only consumed by
   * matching in a later slice.
   */
  async setPreferences(
    token: string | undefined,
    rawMatchingLanguage: unknown,
    rawGender: unknown,
    rawUiLanguage: unknown,
    rawGenderFilter?: unknown
  ): Promise<UserSummary> {
    const record = await this.requireRecord(token);

    if (!isLanguageCode(rawMatchingLanguage)) {
      throw new BadRequestException("Choose a matching language from the supported list.");
    }
    if (!isUserGender(rawGender)) {
      throw new BadRequestException("Choose Male, Female, or Prefer not to say.");
    }
    // UI language is optional: it stays whatever it was (or defaults to the
    // matching language on first onboarding) when the client omits it, but if
    // provided it must be a supported code.
    if (rawUiLanguage !== undefined && !isLanguageCode(rawUiLanguage)) {
      throw new BadRequestException("Choose a UI language from the supported list.");
    }
    // Gender filter is optional: it keeps its current value (or the "both"
    // default) when omitted, but if provided it must be a valid choice.
    if (rawGenderFilter !== undefined && !isGenderFilter(rawGenderFilter)) {
      throw new BadRequestException("Choose a gender filter of Male, Female, or Both.");
    }
    // Gender filtering is a launch kill switch (story 84). When it is off, a user
    // may still clear their filter (set "both") but cannot apply a *narrowing*
    // one, so matching can ignore the preference entirely while it is disabled.
    if (rawGenderFilter !== undefined && rawGenderFilter !== "both") {
      await this.flags.assertEnabled(
        "gender_filters",
        "Gender filtering is temporarily unavailable. You can still match without a filter."
      );
    }

    record.matchingLanguage = rawMatchingLanguage;
    record.gender = rawGender;
    record.uiLanguage =
      rawUiLanguage !== undefined ? rawUiLanguage : (record.uiLanguage ?? rawMatchingLanguage);
    if (rawGenderFilter !== undefined) {
      record.genderFilter = rawGenderFilter;
    }
    record.preferencesUpdatedAt = new Date().toISOString();
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
    if (!userId) {
      return null;
    }
    const record = await this.store.get(userId);
    // Backfill a generated identity for accounts persisted before this slice so
    // every resolved record carries a stable display identity.
    if (record && !record.identity) {
      record.identity = generateDisplayIdentity();
      await this.store.save(record);
    }
    return record;
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
      // resolveRecord guarantees a backfilled identity; fall back defensively for
      // any record constructed outside that path.
      identity: record.identity ?? generateDisplayIdentity(),
      displayNameChange: displayNameChangeStatus(record.displayNameUpdatedAt),
      avatarChange: avatarChangeStatus(record.avatarUpdatedAt),
      preferences: this.preferences(record),
      onboarding: this.onboardingStatus(record),
      legal: this.legalStatus(record),
      safety: this.safetyStatus(record)
    };
  }

  private preferences(record: UserRecord): UserPreferences {
    return {
      uiLanguage: record.uiLanguage ?? defaultLanguage,
      matchingLanguage: record.matchingLanguage ?? defaultLanguage,
      gender: record.gender ?? null,
      genderFilter: record.genderFilter ?? defaultGenderFilter
    };
  }

  /** Onboarding is owed until the user has declared both language and gender. */
  private onboardingStatus(record: UserRecord): OnboardingStatus {
    return { required: record.matchingLanguage === undefined || record.gender === undefined };
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
