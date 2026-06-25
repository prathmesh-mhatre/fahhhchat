export interface GuestSessionRecord {
  sessionId: string;
  legalVersion: string;
  ageConfirmed: boolean;
  acceptedAt: string;
}

export interface GuestSessionSummary {
  accepted: true;
  legalVersion: string;
  acceptedAt: string;
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
