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
  displayNameChangeCooldownHours: 24,
  /**
   * Minimum hours between avatar changes — "once per day" (story 19). Tracked
   * independently of the display-name cooldown so a rename and an avatar swap
   * don't consume each other's daily allowance.
   */
  avatarChangeCooldownHours: 24
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
 * Whether the user may change their avatar right now, surfaced in the
 * guest/user summaries so the picker can disable itself and explain the wait
 * (story 19). Mirrors {@link DisplayNameChangeStatus}: the API is authoritative
 * and this is advisory state for the UI. Part of the API↔web contract.
 */
export interface AvatarChangeStatus {
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

/**
 * Curated set of languages users can pick as their *matching* language signal
 * (story 28) and, separately, their *UI* language (story 27). Both surfaces
 * share this list for the MVP — the data model keeps the two as distinct
 * preference fields so they can diverge later, but offering one supported set
 * keeps onboarding simple. Labels are shown in their own language so the picker
 * is legible regardless of the current UI language. Shared here because the API
 * validates submissions against this exact set and the web app renders it.
 */
export const matchingLanguages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "tr", label: "Türkçe" }
] as const;

export type LanguageCode = (typeof matchingLanguages)[number]["code"];

/** Fallback when a browser language isn't supported or none is declared. */
export const defaultLanguage: LanguageCode = "en";

/** Type-guard for a supported language code. */
export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && matchingLanguages.some((lang) => lang.code === value);
}

/**
 * Normalize a raw browser language tag (e.g. "en-US", "pt-BR", "zh-Hans") to a
 * supported language code, used to seed both the matching- and UI-language
 * defaults from the browser during onboarding (stories 26-28). Falls back to
 * {@link defaultLanguage} when the language isn't in the supported set.
 */
export function resolveLanguage(browserLanguage: unknown): LanguageCode {
  if (typeof browserLanguage !== "string") {
    return defaultLanguage;
  }
  const primary = browserLanguage.toLowerCase().split("-")[0];
  return isLanguageCode(primary) ? primary : defaultLanguage;
}

/**
 * Self-declared gender used by gender filters (story 29). Deliberately minimal —
 * Male, Female, or an explicit "prefer not to say" — so filtering can work
 * without forcing more disclosure. Logged-in only; guests never declare gender.
 */
export const genderOptions = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "prefer_not_to_say", label: "Prefer not to say" }
] as const;

export type UserGender = (typeof genderOptions)[number]["value"];

/** Type-guard for a valid self-declared gender. */
export function isUserGender(value: unknown): value is UserGender {
  return typeof value === "string" && genderOptions.some((option) => option.value === value);
}

/**
 * Gender *filter* a logged-in user picks to guide matching (story 30) — distinct
 * from their own self-declared {@link UserGender}. "Both" means no filtering.
 * The PRD is explicit that this is a *strong preference, not a promise* (story
 * 31): matching first tries declared logged-in users of the chosen gender, then
 * falls back to guests after a visible wait window (stories 32-33), so a filter
 * can still surface guests whose gender is unknown (story 35). Logged-in only.
 * The actual matching behaviour lands in later slices; this set is the shared
 * API↔web contract for capturing and validating the preference.
 */
export const genderFilterOptions = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "both", label: "Both" }
] as const;

export type GenderFilter = (typeof genderFilterOptions)[number]["value"];

/**
 * Default filter: "Both" applies no gender constraint, the right default since a
 * filter is an opt-in narrowing and should never silently shrink a new user's
 * match pool. Onboarding does not block on it (it is not part of
 * {@link OnboardingStatus}); the user adjusts it whenever they like.
 */
export const defaultGenderFilter: GenderFilter = "both";

/** Type-guard for a valid gender filter selection. */
export function isGenderFilter(value: unknown): value is GenderFilter {
  return typeof value === "string" && genderFilterOptions.some((option) => option.value === value);
}

/**
 * A logged-in user's matching/UI preferences. UI language and matching language
 * are kept as *separate* fields (story 27) so interface localization and match
 * preference can evolve independently; both are seeded from the browser language
 * during onboarding. `gender` is null until the user declares it (story 29).
 * Part of the API↔web contract — returned in the user summary.
 */
export interface UserPreferences {
  /** Interface localization language; distinct from {@link matchingLanguage}. */
  uiLanguage: LanguageCode;
  /** Language used as a matching signal (story 28). */
  matchingLanguage: LanguageCode;
  /** Self-declared gender, or null until set (story 29). */
  gender: UserGender | null;
  /**
   * Gender filter guiding matching (story 30); defaults to
   * {@link defaultGenderFilter} ("both") until the user narrows it. A strong
   * preference, not a guarantee (story 31).
   */
  genderFilter: GenderFilter;
}

/**
 * Whether the logged-in user still owes the lightweight onboarding step — i.e.
 * they have not yet declared a matching language and gender (story 28-29). The
 * API is authoritative; the web app uses this to decide whether to show the
 * onboarding form after sign-in.
 */
export interface OnboardingStatus {
  required: boolean;
}

export const featureFlagKeys = [
  "camera_media",
  "gender_filters",
  "guest_access",
  "queue_entry"
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];

/**
 * Enabled/disabled state for every launch kill switch (story 84), keyed by
 * {@link FeatureFlagKey}. The API owns the durable, cached source of truth and
 * returns this shape so the web apps can hide or lock a surface the operator has
 * killed (e.g. drop the camera affordance when `camera_media` is off). Part of
 * the API↔web contract, so it lives here rather than being duplicated.
 */
export type FeatureFlagState = Record<FeatureFlagKey, boolean>;

/**
 * Default state: every surface is on. Flags are *kill switches* — they exist to
 * turn a risky surface off quickly (stories 80, 84), so the safe default is
 * enabled and a stored override only ever flips one off. The API merges any
 * durable overrides over these defaults, which also means a newly added flag is
 * live until an operator explicitly disables it.
 */
export const defaultFeatureFlags: FeatureFlagState = {
  camera_media: true,
  gender_filters: true,
  guest_access: true,
  queue_entry: true
};

/** Type-guard for a known feature flag key. */
export function isFeatureFlagKey(value: unknown): value is FeatureFlagKey {
  return typeof value === "string" && (featureFlagKeys as readonly string[]).includes(value);
}

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

/**
 * Validate a proposed avatar selection against the built-in/generated set,
 * returning a normalized {@link AvatarDescriptor} or null if either the avatar
 * id or background is not part of the safe set (story 19). Because avatars are
 * limited to this curated set — no uploads in MVP (story 20) — selection needs
 * only set-membership validation, not moderation. Shared by the guest and
 * logged-in services so both enforce the identical allow-list.
 */
export function resolveAvatarSelection(
  avatarId: unknown,
  backgroundColor: unknown
): AvatarDescriptor | null {
  if (
    typeof avatarId === "string" &&
    typeof backgroundColor === "string" &&
    avatarSet.some((avatar) => avatar.id === avatarId) &&
    (avatarBackgrounds as readonly string[]).includes(backgroundColor)
  ) {
    return { avatarId, backgroundColor };
  }
  return null;
}
