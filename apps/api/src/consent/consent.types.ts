/**
 * Cookie/privacy consent for the chat app (issue #7, user story 12).
 *
 * Consent separates two categories:
 * - `essential` — safety/operational behavior (session cookies, rate limits,
 *   moderation). Always allowed; never gated on a consent decision.
 * - `analytics` — optional product/safety analytics (the in-house tracker in
 *   issue #48). Allowed only when the visitor has opted in (or, in opt-out
 *   regions, until they opt out).
 *
 * The decision is region-aware: opt-in regions (GDPR/UK and similar) require
 * explicit opt-in and keep analytics off until then; other regions default to
 * implied (opt-out) analytics. Consent is stored in a small signed cookie, so
 * the gate works for any visitor without a guest session.
 */

/** How analytics consent is obtained for the visitor's region. */
export type ConsentRegime = "opt_in" | "opt_out";

export type ConsentCategory = "essential" | "analytics";

/** The decision persisted in the signed consent cookie. */
export interface ConsentDecision {
  version: string;
  analytics: boolean;
  decidedAt: string;
}

/**
 * Consent state for a visitor, returned to the client and consulted by the
 * (future) analytics tracker via {@link ConsentService.isAnalyticsAllowed}.
 */
export interface ConsentStatus {
  /** Current consent policy version (from productConfig). */
  version: string;
  /** Resolved ISO-3166 country code, or "unknown" when undetectable. */
  region: string;
  regime: ConsentRegime;
  /** Essential cookies are always permitted; surfaced for an honest UI. */
  essential: true;
  /** Effective analytics-allowed state for this visitor right now. */
  analytics: boolean;
  /** True when the consent banner must be shown (no decision, or stale version). */
  required: boolean;
  /** When the current decision was made, or null if none applies. */
  decidedAt: string | null;
}

export const CONSENT_COOKIE_NAME = "fc_consent";

/** Consent decisions persist for 180 days before the banner re-appears. */
export const CONSENT_TTL_SECONDS = 60 * 60 * 24 * 180;

/**
 * Regions that require explicit analytics opt-in (EEA + UK + EFTA). Visitors
 * from anywhere else — or an undetectable region — fall under the opt-out
 * regime. Kept here rather than in shared config because it is a backend-only
 * policy detail; the client receives the resolved regime, not the list.
 */
export const OPT_IN_REGIONS: ReadonlySet<string> = new Set([
  // EU member states
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA/EFTA + UK
  "IS", "LI", "NO", "GB"
]);
