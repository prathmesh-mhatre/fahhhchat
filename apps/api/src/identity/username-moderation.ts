import { productConfig } from "@fahhhchat/config";

/**
 * Display-name (username) moderation: the isolated, framework-free rule engine
 * the PRD calls out as a deep module to test in isolation. Users may rename
 * their generated identity once per day (story 16); every proposed name is
 * moderated *before* saving (story 17) and rejected when it contains slurs,
 * sexual terms, contact info, URLs, social handles, or reserved platform terms
 * (story 18).
 *
 * Deliberately rule-based, not AI (per the PRD's day-one moderation stance).
 * Matching is done against a normalized "compact" form (lowercased, punctuation
 * and whitespace stripped) so simple evasions like "f.u.c.k" or "i n s t a"
 * collapse to the same token we screen. Lists are kept tight to avoid the
 * Scunthorpe-style false positives that substring matching invites.
 */

/** Why a proposed display name was rejected; drives the user-facing message. */
export type DisplayNameRejectionCode =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "url"
  | "contact_info"
  | "social_handle"
  | "reserved"
  | "slur"
  | "sexual";

export type DisplayNameModerationResult =
  | { ok: true; value: string }
  | { ok: false; code: DisplayNameRejectionCode; message: string };

/**
 * Reserved platform/role terms a stranger must never be able to impersonate.
 * Matched as whole words against the lowercased, space-normalized name.
 */
const RESERVED_WORDS = [
  "admin",
  "administrator",
  "moderator",
  "mod",
  "support",
  "staff",
  "system",
  "official",
  "help",
  "helpdesk",
  "root",
  "owner",
  "fahhhchat",
  "fahchat"
];

/**
 * Social platform / handle keywords. People use these to route strangers off
 * the platform; treat them as contact info. Matched against the compact form so
 * "i n s t a g r a m" and "insta.gram" still trip. Kept multi-letter to avoid
 * colliding with ordinary words.
 */
const SOCIAL_KEYWORDS = [
  "instagram",
  "insta",
  "snapchat",
  "snap",
  "telegram",
  "whatsapp",
  "discord",
  "tiktok",
  "onlyfans",
  "cashapp",
  "venmo",
  "paypal",
  "twitter",
  "reddit",
  "kik",
  "skype"
];

/**
 * Curated slur list. Intentionally small and matched on the compact form so
 * spacing/punctuation evasions collapse into it. This is an MVP seed, not an
 * exhaustive list; the admin/moderation slices extend enforcement.
 */
const SLUR_FRAGMENTS = ["nigger", "nigga", "faggot", "fag", "retard", "chink", "kike", "spic", "tranny"];

/**
 * Explicit sexual terms. The PRD lets ordinary adult chat through but keeps
 * *display names* clean, so these are rejected for usernames specifically.
 */
const SEXUAL_FRAGMENTS = [
  "fuck",
  "shit",
  "cock",
  "pussy",
  "dick",
  "cum",
  "anal",
  "blowjob",
  "boobs",
  "tits",
  "porn",
  "sex",
  "horny",
  "milf",
  "rape",
  "slut",
  "whore"
];

const MESSAGES: Record<DisplayNameRejectionCode, string> = {
  empty: "Enter a display name.",
  too_short: `Display names must be at least ${productConfig.displayNameMinLength} characters.`,
  too_long: `Display names must be ${productConfig.displayNameMaxLength} characters or fewer.`,
  invalid_characters: "Use only letters, numbers, spaces, hyphens, and apostrophes.",
  url: "Display names can't contain web links.",
  contact_info: "Display names can't contain contact info like phone numbers or emails.",
  social_handle: "Display names can't reference other apps or social handles.",
  reserved: "That name is reserved. Please choose another.",
  slur: "That name isn't allowed. Please choose another.",
  sexual: "That name isn't allowed. Please choose another."
};

function reject(code: DisplayNameRejectionCode): DisplayNameModerationResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/** Lowercase and strip everything but letters/digits, for evasion-resistant matching. */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Validate and normalize a proposed display name. On success, returns the
 * normalized value to persist (trimmed, internal whitespace collapsed).
 */
export function moderateDisplayName(raw: unknown): DisplayNameModerationResult {
  if (typeof raw !== "string") {
    return reject("empty");
  }

  // Normalize: trim ends, collapse any run of whitespace to a single space.
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) {
    return reject("empty");
  }
  if (name.length < productConfig.displayNameMinLength) {
    return reject("too_short");
  }
  if (name.length > productConfig.displayNameMaxLength) {
    return reject("too_long");
  }

  // Allowed surface charset: letters, numbers, spaces, hyphen, apostrophe. This
  // alone blocks "@handles", emoji, and most URL/email punctuation, but we run
  // the specific checks first so the rejection reason is meaningful.
  const lower = name.toLowerCase();
  const flat = compact(name);

  // URLs / domains.
  if (/https?:\/\//.test(lower) || /\bwww\./.test(lower) || /[a-z0-9-]+\.(com|net|org|io|co|xyz|me|gg|tv|app|link)\b/.test(lower)) {
    return reject("url");
  }

  // Contact info: emails, "@", or runs of digits long enough to be a phone number.
  if (/@/.test(name) || /\b\d[\d\s-]{4,}\d\b/.test(name) || /\d{5,}/.test(flat)) {
    return reject("contact_info");
  }

  // Social handles / off-platform routing.
  if (SOCIAL_KEYWORDS.some((kw) => flat.includes(kw))) {
    return reject("social_handle");
  }

  // Reserved platform/role terms — whole-word match on the spaced lowercase form.
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => RESERVED_WORDS.includes(word)) || RESERVED_WORDS.some((w) => flat === w)) {
    return reject("reserved");
  }

  // Slurs and explicit sexual terms — compact-substring match.
  if (SLUR_FRAGMENTS.some((frag) => flat.includes(frag))) {
    return reject("slur");
  }
  if (SEXUAL_FRAGMENTS.some((frag) => flat.includes(frag))) {
    return reject("sexual");
  }

  // Final charset gate for anything the specific rules didn't already catch.
  if (!/^[A-Za-z0-9 '-]+$/.test(name)) {
    return reject("invalid_characters");
  }

  return { ok: true, value: name };
}
