export const productConfig = {
  name: "Fahhhchat",
  apiServiceName: "fahhhchat-api",
  legalVersion: "2026-05-issue-1",
  safetyGuidelinesVersion: "2026-06-issue-6",
  /**
   * Cookie/privacy consent policy version. Bump when the analytics/essential
   * cookie disclosure changes so visitors are re-prompted (see issue #7).
   */
  consentVersion: "2026-06-issue-7",
  reconnectGraceSeconds: 25,
  nextConfirmSeconds: 3
} as const;

/**
 * Dev-only contract for simulating a Google login without real OAuth
 * credentials. The web app encodes a chosen identity into a `mock.` token and
 * the API's dev verifier decodes it (only when `AUTH_DEV_MODE=true`). Keeping the
 * format here ensures both sides stay in agreement. Never accepted in production.
 */
export const MOCK_GOOGLE_TOKEN_PREFIX = "mock.";

export function encodeMockGoogleToken(identity: { sub: string; email: string }): string {
  return MOCK_GOOGLE_TOKEN_PREFIX + Buffer.from(JSON.stringify(identity)).toString("base64url");
}

export const featureFlagKeys = [
  "camera_media",
  "gender_filters",
  "guest_access",
  "queue_entry"
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];
