export interface GuestSessionRecord {
  sessionId: string;
  legalVersion: string;
  ageConfirmed: boolean;
  acceptedAt: string;
  /** Safety guidelines version the user last accepted, or undefined if never. */
  safetyGuidelinesVersion?: string;
  safetyGuidelinesAcceptedAt?: string;
  /**
   * Set after an enforcement event (warning/ban) so the guidelines are shown
   * again on the user's next visit even if the version has not changed. Cleared
   * when the user re-accepts. The moderation slice (#32) flips this flag.
   */
  safetyRepromptRequired?: boolean;
}

/** Why the safety guidelines gate is being shown, or null when not required. */
export type SafetyGuidelinesReason = "first_time" | "version_changed" | "enforcement";

export interface SafetyGuidelinesStatus {
  /** True when the user must (re-)accept the guidelines before chatting. */
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  reason: SafetyGuidelinesReason | null;
}

export interface GuestSessionSummary {
  accepted: true;
  legalVersion: string;
  acceptedAt: string;
  safety: SafetyGuidelinesStatus;
}

/**
 * Server-side store for guest sessions. The PRD calls for Redis-backed sessions
 * (`issues/prd.md`), so production wires a Redis implementation; an in-memory
 * implementation keeps the slice demoable and unit-testable without Redis.
 */
export interface SessionStore {
  save(record: GuestSessionRecord): Promise<void>;
  get(sessionId: string): Promise<GuestSessionRecord | null>;
}

export const SESSION_STORE = Symbol("SESSION_STORE");

export const GUEST_COOKIE_NAME = "fc_guest";

/** Guest sessions are lightweight and session-scoped; expire after 24h. */
export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24;
