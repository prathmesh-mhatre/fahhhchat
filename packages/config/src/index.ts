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
  nextConfirmSeconds: 3,
  /**
   * Display-name editing rules shared by the API (which enforces them) and the
   * web app (which hints them in the editor). The PRD allows a once-daily
   * username change for guests and logged-in users (story 16), moderated before
   * saving (stories 17-18). Length bounds keep names renderable in the chat UI.
   */
  displayNameMinLength: 3,
  displayNameMaxLength: 24,
  /** Minimum hours between display-name changes — "once per day" (story 16). */
  displayNameChangeCooldownHours: 24
} as const;

/**
 * Whether the user may change their display name right now, surfaced in the
 * guest/user summaries so the editor can disable itself and explain the wait.
 * The API is authoritative — this is advisory state for the UI. Lives here
 * because it is part of the API↔web contract.
 */
export interface DisplayNameChangeStatus {
  /** True when a change is allowed now (no active once-per-day cooldown). */
  allowed: boolean;
  /** ISO timestamp when the next change is allowed, or null if allowed now. */
  nextAllowedAt: string | null;
}

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

/**
 * Generated display identity assigned to every user (guest or logged-in). The
 * PRD models identity around an internal id and never the public Google
 * identity, so all users — including logged-in ones — are shown to matched
 * strangers as an anonymous generated name + avatar (stories 13-15). The
 * backend owns generation; the frontend renders {@link AvatarDescriptor} using
 * the shared {@link avatarSet}/{@link avatarBackgrounds}, so the avatar set must
 * agree across both surfaces — hence it lives here in `@fahhhchat/config`.
 */
export interface AvatarDescriptor {
  /** Id of the chosen avatar from {@link avatarSet}. */
  avatarId: string;
  /** Background color (hex) from {@link avatarBackgrounds}. */
  backgroundColor: string;
}

export interface DisplayIdentity {
  /** Anonymous, non-unique generated name, e.g. "Mellow Otter". */
  displayName: string;
  avatar: AvatarDescriptor;
}

/**
 * Built-in, safe avatar set. Avatars are limited to this generated/built-in set
 * (no uploads in MVP). Each entry carries a stable `id` (persisted) and a
 * renderable `glyph` so the frontend needs no asset pipeline for the MVP. Later
 * avatar editing (issue #12) picks from exactly this set.
 */
export const avatarSet = [
  { id: "otter", glyph: "🦦" },
  { id: "fox", glyph: "🦊" },
  { id: "owl", glyph: "🦉" },
  { id: "panda", glyph: "🐼" },
  { id: "cat", glyph: "🐱" },
  { id: "koala", glyph: "🐨" },
  { id: "penguin", glyph: "🐧" },
  { id: "hedgehog", glyph: "🦔" },
  { id: "frog", glyph: "🐸" },
  { id: "turtle", glyph: "🐢" },
  { id: "bee", glyph: "🐝" },
  { id: "dolphin", glyph: "🐬" }
] as const;

export type AvatarId = (typeof avatarSet)[number]["id"];

/** Background palette for avatars; chosen alongside the avatar id. */
export const avatarBackgrounds = [
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#06B6D4",
  "#EF4444",
  "#6366F1"
] as const;

/** Resolve an avatar id to its renderable glyph, or undefined if unknown. */
export function avatarGlyph(avatarId: string): string | undefined {
  return avatarSet.find((avatar) => avatar.id === avatarId)?.glyph;
}
