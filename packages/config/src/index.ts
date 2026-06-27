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
   * Maximum length (characters) of a single realtime chat message (issue #21).
   * The API rejects anything longer than this so an oversized or runaway message
   * can never be delivered or buffered; the web app uses the same bound to cap
   * its composer and show a remaining-characters hint. Shared because both sides
   * must agree on the limit the API enforces.
   */
  chatMessageMaxLength: 2000,
  /**
   * How many of the most recent messages an active match keeps in its ephemeral,
   * match-scoped buffer (issue #21, story 46). The buffer exists only so the
   * realtime layer has the recent conversation in hand while the match is live;
   * it is dropped the moment the match ends, so chat history never persists. Kept
   * small — a rolling window, not durable history — because the product is
   * intentionally ephemeral and the report-context buffer (issue #29) is separate.
   */
  chatBufferMaxMessages: 50,
  /**
   * How long a waiting user holds out for a same-matching-language partner before
   * the pool relaxes and pairs them across languages (story 36). Kept short so
   * wait times stay low while still preferring a relevant match initially; the
   * web app can surface a "broadening your search" hint once this window passes.
   * Shared because the API enforces it and the web app messages it.
   */
  languageRelaxAfterSeconds: 15,
  /**
   * How long a logged-in user with a *narrowing* gender filter (Male/Female)
   * holds out for a declared logged-in user of that gender before matching
   * relaxes and lets them fall back to guests — and to logged-in users whose
   * gender doesn't match (stories 31-33, 35). The filter is a strong preference,
   * never a promise, so the window is deliberately short but long enough to be a
   * *visible* wait the web app can message ("Looking for your preference… we'll
   * broaden the search shortly"). Independent of the language window: a waiter
   * relaxes each axis on its own timer. Shared because the API enforces it and
   * the web app surfaces it. "Both" carries no filter, so it never waits.
   */
  genderRelaxAfterSeconds: 20,
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
  avatarChangeCooldownHours: 24,
  /**
   * How long, after a user reports-with-block or blocks the stranger they were
   * matched with, the two identities are kept out of each other's matches (issue
   * #27, stories 53-54). The PRD's goal is only to prevent an *immediate* rematch
   * — "do not encounter the same person right away" — not a durable block list
   * (anonymous guests have no durable identity to permanently block against), so
   * this is a recency window rather than forever. Kept long enough that the two
   * won't bump into each other again within a normal session, but bounded so the
   * ephemeral matching state self-clears. The API enforces it; the window is the
   * only knob, so it lives here with the other realtime-matching timings.
   */
  rematchPreventionSeconds: 1800
} as const;

/**
 * Whether the "also block this user" option on the report dialog is checked by
 * default (issue #27, story 56). Reporting *usually* should also protect the
 * reporter from rematching, so the box defaults on; the reporter can still
 * uncheck it to report without blocking. Shared because both sides must agree on
 * the same default: the web app pre-checks the box from this value, and the API
 * uses it as the default when a report request omits the `alsoBlock` flag, so an
 * older or minimal client that doesn't send the field still gets the protective
 * default rather than silently skipping the block.
 */
export const reportDefaultsAlsoBlock = true;

/**
 * The categories a reporter can file a report under (issue #28, story 59). The
 * reporter must pick one — a report is always *category-tagged* — but the details
 * are optional, so a category-only report is accepted (story 60). Shared so the
 * web app's report form, the API that validates incoming reports, and the future
 * admin review surface all agree on the exact set and order.
 *
 * Ordered roughly most-severe-first as the form should present them, with `other`
 * last as the catch-all. `other` is also the server's fallback: an incoming report
 * whose category is missing or unrecognised is normalised to `other` rather than
 * rejected, because a report must always succeed in ending an unsafe chat — the
 * category is metadata for moderators, never a gate on filing (story 60).
 *
 * `media_abuse` is included now even though media sharing arrives in a later slice
 * (the category vocabulary is the durable contract); it pairs with the media-abuse
 * report metadata handled in issue #44.
 */
export const reportCategories = [
  "harassment_hate",
  "sexual_content",
  "underage",
  "spam_scam",
  "media_abuse",
  "self_harm_threats",
  "other",
] as const;

/** A single report category from the shared {@link reportCategories} vocabulary. */
export type ReportCategory = (typeof reportCategories)[number];

/**
 * Human-readable labels for the report categories (issue #28, story 59), shared so
 * the report form and the admin review surface render the same wording. The ids in
 * {@link reportCategories} are the stable contract; this copy can be reworded
 * without a data migration.
 */
export const reportCategoryLabels: Record<ReportCategory, string> = {
  harassment_hate: "Harassment or hate",
  sexual_content: "Unwanted sexual content",
  underage: "Underage concern",
  spam_scam: "Spam or scam",
  media_abuse: "Camera / media abuse",
  self_harm_threats: "Self-harm or threats",
  other: "Something else",
};

/**
 * The category an incoming report falls back to when it names none, or names one
 * the server does not recognise (story 60) — see {@link normalizeReportCategory}.
 */
export const defaultReportCategory: ReportCategory = "other";

/**
 * Maximum length (characters) of the optional free-text report details (issue #28,
 * story 61). Details are optional context for moderators, not a message, so the
 * cap is generous but bounded — the API truncates anything longer (and the form
 * limits its textarea to match) so an oversized blob can never be filed.
 */
export const reportDetailsMaxLength = 1000;

/** Type guard: whether `value` is one of the known {@link reportCategories}. */
export function isReportCategory(value: unknown): value is ReportCategory {
  return (
    typeof value === "string" &&
    (reportCategories as readonly string[]).includes(value)
  );
}

/**
 * Normalise a client-supplied report category to a known one, defaulting to
 * {@link defaultReportCategory} when it is missing or unrecognised (story 60). Used
 * on the API boundary so a malformed or outdated client can never make a report
 * fail to file — the worst case is an `other`-tagged report a moderator triages.
 */
export function normalizeReportCategory(value: unknown): ReportCategory {
  return isReportCategory(value) ? value : defaultReportCategory;
}

/**
 * Normalise the optional free-text report details (story 61): trim surrounding
 * whitespace, collapse an empty/whitespace-only value to `undefined` (a
 * category-only report, story 60), and cap the result at
 * {@link reportDetailsMaxLength} so an oversized blob can't be filed. Shared so the
 * web app and the API agree on exactly what an "empty" and a "too long" detail are.
 */
export function normalizeReportDetails(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, reportDetailsMaxLength);
}

/**
 * Curated TLDs the detector recognizes in a *bare* domain (one written without a
 * scheme), e.g. "example.com" or "sub.site.io/path". Kept to TLDs people actually
 * use to route a stranger off-platform so ordinary prose with a period
 * ("ok.bye", "see you...") is not misread as a link. Scheme-prefixed
 * ("https://…") and "www."-prefixed URLs are matched regardless of TLD.
 *
 * Shared because the API (which flags and rate-limits link spam — story 45) and
 * the web app (which renders URL-like text as non-clickable plain text — story
 * 44) must agree on exactly what counts as "URL-like".
 */
export const urlLikeTlds = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "xyz",
  "me",
  "gg",
  "tv",
  "app",
  "link",
  "info",
  "biz",
  "dev",
  "ai",
  "to",
  "ly",
  "site",
  "online",
  "live",
  "shop",
  "club"
] as const;

/**
 * Source for the URL-like matcher. Two alternatives:
 *   1. A scheme- or "www."-prefixed run, matched greedily to the next
 *      whitespace regardless of TLD.
 *   2. A bare `host.tld` (with optional sub-domains and path) whose final label
 *      is one of {@link urlLikeTlds}.
 * A fresh `RegExp` is built per call in {@link findUrlLikeSpans} because a global
 * regex carries mutable `lastIndex` state that must not be shared.
 */
const URL_LIKE_SOURCE = [
  String.raw`(?:https?:\/\/|www\.)[^\s]+`,
  String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:${urlLikeTlds.join(
    "|"
  )})\b(?:\/[^\s]*)?`
].join("|");

/**
 * A URL-like run located within a piece of text: the character range and the
 * matched substring. The web app uses the ranges to split a message into
 * plain-text and URL segments so URLs render as inert text rather than anchors
 * (story 44); the API only needs {@link containsUrlLike}.
 */
export interface UrlSpan {
  /** Start index (inclusive) of the run within the original text. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** The matched URL-like substring (trailing sentence punctuation removed). */
  value: string;
}

/**
 * Locate every URL-like run in `text`, in order. Trailing sentence punctuation
 * (`. , ! ? ; : ) ]`) is trimmed off each match so "visit https://a.com." does
 * not pull the period into the link span. Returns an empty array for non-strings
 * and text with no URL-like content.
 */
export function findUrlLikeSpans(text: string): UrlSpan[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const spans: UrlSpan[] = [];
  const pattern = new RegExp(URL_LIKE_SOURCE, "gi");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const value = match[0].replace(/[.,!?;:)\]]+$/, "");
    if (value.length === 0) {
      continue;
    }
    spans.push({ start, end: start + value.length, value });
  }
  return spans;
}

/**
 * Whether `text` contains at least one URL-like run. The cheap predicate the API
 * uses to decide a message is link-bearing — and so should count against the
 * {@link rateLimits}.`chat_link` spam budget (story 45).
 */
export function containsUrlLike(text: string): boolean {
  return findUrlLikeSpans(text).length > 0;
}

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

/**
 * A single rate-limit threshold: at most {@link limit} actions are allowed per
 * rolling {@link windowSeconds} window before further attempts are throttled.
 * Shared because the API enforces these and the web apps message them ("you're
 * doing that too fast — try again in N seconds").
 */
export interface RateLimitRule {
  /** Maximum allowed attempts within the window. */
  limit: number;
  /** Window length in seconds the {@link limit} is counted over. */
  windowSeconds: number;
}

/**
 * Identity tiers abuse controls treat differently. Guests are anonymous and
 * cheap to mint, so they get *stricter* thresholds than logged-in accounts
 * (story 142); logged-in users still get an *enforced* (not unlimited) ceiling
 * so login is never an abuse bypass (story 143).
 */
export type RateLimitTier = "guest" | "user";

/**
 * Rate-limited actions. Matching actions (story 144): joining the shared pool
 * and (re)connecting to realtime. Deliberately does *not* include clicking Next
 * — the PRD forbids a rapid-Next cooldown beyond the two-step confirmation
 * (story 145), so Next stays fluid and is never throttled here.
 *
 * `chat_link` is the spam-control budget for *URL-bearing* chat messages (story
 * 45): only a message that {@link containsUrlLike} counts against it, so ordinary
 * chat is never throttled but a burst of links is. Keyed per identity like the
 * others — stricter for guests than logged-in users.
 */
export type RateLimitAction = "queue_join" | "reconnect" | "chat_link";

/**
 * Layered abuse-control thresholds for matching operations, keyed by action and
 * identity tier (stories 140-144). Guests are throttled harder than logged-in
 * users on every action (stricter `limit`), but both tiers are capped so neither
 * anonymous abuse nor a logged-in bot can overload matching. Enforced by the API
 * keyed on the layered identity signal available today — the logged-in account
 * id or the guest session id (story 140); IP/device signals and adaptive bot
 * protection layer on in their own slices. Windows are short so a brief burst
 * recovers quickly for ordinary users. Shared so the web app can surface the
 * same numbers it is being limited by.
 */
export const rateLimits: Record<
  RateLimitAction,
  Record<RateLimitTier, RateLimitRule>
> = {
  queue_join: {
    guest: { limit: 10, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 }
  },
  reconnect: {
    guest: { limit: 15, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 }
  },
  /**
   * URL-bearing messages per window (story 45). Generous enough that genuinely
   * sharing a link in conversation is never blocked, tight enough that a
   * link-spam flood is throttled after a handful. Only messages that contain a
   * URL-like span are counted, so a normal chat never touches this budget.
   */
  chat_link: {
    guest: { limit: 4, windowSeconds: 60 },
    user: { limit: 8, windowSeconds: 60 }
  }
};

/**
 * Admin roles gating the safety/operations tooling (stories 82-83). Admin access
 * requires Google login *plus* one of these database-stored roles — a general
 * Google user with no role is never an admin. The set is deliberately small for
 * the MVP: `admin` covers day-to-day report review and enforcement, while
 * `superadmin` is reserved for managing other admins/roles. Roles are stored on
 * the durable admin record (Postgres per the PRD); this list is the shared
 * vocabulary so the API and any future admin UI agree on the exact role names.
 */
export const adminRoles = ["admin", "superadmin"] as const;

export type AdminRole = (typeof adminRoles)[number];

/** Type-guard for a known admin role. */
export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (adminRoles as readonly string[]).includes(value);
}

/**
 * Environment variable carrying the comma-separated allowlist of initial admin
 * emails (story 83). Seeded admins are granted the default admin role on boot so
 * launch access can be controlled without a migration. The value is a Google
 * email (internal-use identity), never shown publicly.
 */
export const ADMIN_ALLOWLIST_ENV = "ADMIN_EMAIL_ALLOWLIST";

/**
 * Parse a raw allowlist string (e.g. the {@link ADMIN_ALLOWLIST_ENV} value) into
 * a normalized, de-duplicated list of admin emails. Entries are trimmed and
 * lower-cased so allowlist matching is case-insensitive (Google emails are), and
 * blank entries are dropped so a trailing comma or empty env var yields no
 * admins. Shared so the API seeds exactly what an operator configured.
 */
export function parseAdminAllowlist(raw: string | undefined | null): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const email = entry.trim().toLowerCase();
    if (email.length > 0) {
      seen.add(email);
    }
  }
  return [...seen];
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
 * Why the in-chat camera affordance is locked for the current match (stories
 * 125-126): the affordance is always *visible* but only usable when every gate
 * is open, so when it is locked the UI must explain *which* gate is closed.
 * Ordered most-actionable-first so {@link cameraMediaEligibility} reports the
 * single reason most worth surfacing:
 *
 * - `flag_disabled` — the `camera_media` launch kill switch is off (story 84);
 *   nobody can share, so this dominates the per-user login gates.
 * - `viewer_not_logged_in` — *you* are a guest; signing in is the user's own
 *   next step (story 97), so it outranks the partner's status.
 * - `partner_not_logged_in` — your partner is a guest; nothing you can do but
 *   it still explains the lock honestly (story 126).
 */
export type CameraMediaLockReason =
  | "flag_disabled"
  | "viewer_not_logged_in"
  | "partner_not_logged_in";

/**
 * Inputs to {@link cameraMediaEligibility}. Media sharing is a *post-match*
 * capability (PRD decision), available only when BOTH matched users are
 * logged in (story 97) *and* the `camera_media` kill switch is on (story 84) —
 * it is never a separate matchmaking pool. The two login bits come from the
 * match: the viewer knows their own identity tier, and the match payload
 * carries whether the partner is logged in.
 */
export interface CameraMediaEligibilityInput {
  /** Whether the `camera_media` feature flag is currently enabled (story 84). */
  flagEnabled: boolean;
  /** Whether the current (viewing) user is a logged-in account, not a guest. */
  viewerLoggedIn: boolean;
  /** Whether the matched partner is a logged-in account, not a guest. */
  partnerLoggedIn: boolean;
}

/**
 * Eligibility result for the in-chat camera affordance. `available: true` means
 * every gate is open and the affordance is unlocked; `available: false` carries
 * the single dominant {@link CameraMediaLockReason} so the UI can both lock the
 * control and explain *why* (stories 125-126). When available the `reason` is
 * null. Pure and shared because the same gate is reasoned about across the
 * frontend (locked UI) and is part of the API↔web contract feeding it.
 */
export type CameraMediaEligibility =
  | { available: true; reason: null }
  | { available: false; reason: CameraMediaLockReason };

/**
 * Decide whether the camera-media affordance is usable for a match, or, if not,
 * the single most-actionable reason it is locked (stories 97, 125-126). The flag
 * kill switch dominates (when off, no login could unlock it), then the viewer's
 * own login (their actionable next step), then the partner's. Returning a
 * structured reason — not a boolean — is what lets the locked affordance stay
 * visible *and* explain itself rather than silently disappearing.
 */
export function cameraMediaEligibility(
  input: CameraMediaEligibilityInput
): CameraMediaEligibility {
  if (!input.flagEnabled) {
    return { available: false, reason: "flag_disabled" };
  }
  if (!input.viewerLoggedIn) {
    return { available: false, reason: "viewer_not_logged_in" };
  }
  if (!input.partnerLoggedIn) {
    return { available: false, reason: "partner_not_logged_in" };
  }
  return { available: true, reason: null };
}

/**
 * Human-readable copy for each {@link CameraMediaLockReason}, shared so every
 * surface that locks the camera affordance explains it identically (story 126).
 * Each entry pairs a short `label` (the visible hint) with a fuller
 * `description` suitable for an accessible name / tooltip / screen-reader text.
 */
export const cameraMediaLockMessages: Record<
  CameraMediaLockReason,
  { label: string; description: string }
> = {
  flag_disabled: {
    label: "Camera sharing is currently unavailable",
    description:
      "Camera sharing is turned off right now. Please check back later."
  },
  viewer_not_logged_in: {
    label: "Sign in to share your camera",
    description:
      "Camera sharing is only available when both people are signed in. Sign in to unlock it."
  },
  partner_not_logged_in: {
    label: "Both people must be signed in",
    description:
      "Camera sharing is only available when both people are signed in, and the person you're matched with is a guest."
  }
} as const;

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

/**
 * Deterministic moderation rule engine (issue #31). Shared here because its
 * lexicon and severity contract must agree across the API (which moderates
 * realtime chat) and the identity layer (which moderates usernames, story 18),
 * so the rules live in exactly one place rather than being duplicated per
 * surface. Re-exported from the package root so consumers import everything from
 * `@fahhhchat/config`.
 */
export {
  moderateText,
  moderateUsername,
  severityAtLeast,
  type ModerationCategory,
  type ModerationSeverity,
  type ModerationMatch,
  type ModerationResult,
  type UsernameRejectionCode,
} from "./moderation";
