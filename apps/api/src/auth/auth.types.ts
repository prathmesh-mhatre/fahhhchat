/**
 * Durable record for a logged-in (Google-authenticated) user. The PRD models
 * identity around an internal user id and *never* the public Google identity,
 * so `googleSub`/`email` are stored only for authentication, admin, and
 * moderation use — they are never returned in any client-facing summary.
 *
 * Durable user records belong in PostgreSQL per the PRD; this slice ships the
 * {@link UserStore} contract with an in-memory implementation so login is
 * demoable and unit-testable, and a Postgres-backed store can drop in later
 * without touching the service.
 */
export interface UserRecord {
  /** Pseudonymous internal id. Used for identity, analytics, and matching. */
  userId: string;
  /** Google subject id — stable per Google account. Internal use only. */
  googleSub: string;
  /** Google email — internal auth/admin/moderation use only, never public. */
  email: string;
  createdAt: string;
  lastLoginAt: string;
  /**
   * Anonymous generated name + avatar shown to matched strangers instead of the
   * Google identity (story 14). Persisted on the account so it stays stable
   * across logins/sessions (story 22). Optional only so accounts created before
   * this slice can be backfilled on next login.
   */
  identity?: DisplayIdentity;
  /**
   * When the account last *changed* its display name (story 16). Undefined while
   * the name is still the generated default. Drives the once-per-day cooldown
   * and persists with the account across sessions.
   */
  displayNameUpdatedAt?: string;
  /** Persisted legal/age acceptance for the account (story 22). */
  legalVersion?: string;
  ageConfirmed?: boolean;
  legalAcceptedAt?: string;
  /** Persisted safety-guidelines acceptance, mirroring the guest session. */
  safetyGuidelinesVersion?: string;
  safetyGuidelinesAcceptedAt?: string;
  /** Set after enforcement to re-show guidelines next visit; cleared on accept. */
  safetyRepromptRequired?: boolean;
}

import type { DisplayIdentity, DisplayNameChangeStatus } from "@fahhhchat/config";
import type { SafetyGuidelinesStatus } from "../session/session.types";

/** Whether the logged-in user still owes legal/age acceptance. */
export interface LegalAcceptanceStatus {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
}

/**
 * Client-facing view of a logged-in user. Deliberately excludes `googleSub`
 * and `email` so the Google identity is never exposed to the browser or, by
 * extension, to matched strangers (PRD privacy constraint).
 */
export interface UserSummary {
  loggedIn: true;
  userId: string;
  /** Generated display name + avatar shown in place of Google identity (story 14). */
  identity: DisplayIdentity;
  /** Whether the once-per-day display-name change is available (story 16). */
  displayNameChange: DisplayNameChangeStatus;
  legal: LegalAcceptanceStatus;
  safety: SafetyGuidelinesStatus;
}

/** A verified Google identity, as produced by {@link GoogleTokenVerifier}. */
export interface GoogleIdentity {
  sub: string;
  email: string;
}

/** Persistence contract for logged-in users (Postgres in production). */
export interface UserStore {
  findByGoogleSub(googleSub: string): Promise<UserRecord | null>;
  get(userId: string): Promise<UserRecord | null>;
  save(record: UserRecord): Promise<void>;
}

export const USER_STORE = Symbol("USER_STORE");

export const GOOGLE_TOKEN_VERIFIER = Symbol("GOOGLE_TOKEN_VERIFIER");

/** HTTP-only cookie carrying the backend-minted app session JWT. */
export const USER_COOKIE_NAME = "fc_user";

/** Logged-in sessions persist across visits; the app JWT lasts 30 days. */
export const USER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
