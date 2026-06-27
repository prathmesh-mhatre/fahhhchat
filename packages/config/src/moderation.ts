import { containsUrlLike } from "./index";

/**
 * Deterministic, rule-based moderation engine for chat text and usernames
 * (issue #31, stories 66-68). Per the PRD's day-one stance this is *rule-based,
 * never AI*: every decision is an explicit, testable pattern match, so the same
 * input always yields the same structured verdict and later enforcement slices
 * (#32 — warnings, rate limits, auto-end, escalation) can build on a stable
 * contract.
 *
 * The engine lives in `@fahhhchat/config` rather than inside the API because its
 * lexicon and severity rules are a cross-cutting contract: the API enforces them
 * on realtime chat, and the same lists back username moderation (story 18) so a
 * term banned in a name and a term flagged in chat never drift apart. Nothing
 * here imports a framework — it is a pure function over strings.
 *
 * Design intent (stories 67-68): the engine is deliberately *narrow*. It does
 * NOT block ordinary profanity ("fuck", "shit", "asshole") and does NOT
 * blanket-ban consensual adult sexual talk. It targets only content that is
 * unambiguously harmful: slurs, credible threats, targeted harassment, spam/
 * scams, underage signals, and illegal / non-consensual / exploitative sexual
 * patterns. When in doubt it stays silent — false negatives are recoverable via
 * human review (stories 58-62, 76); over-moderation is the failure the PRD
 * explicitly calls out.
 */

/**
 * The kind of harm a rule matched. Categories mirror the PRD's enumerated
 * concerns (story 66) plus the username-specific surfaces (story 18). A single
 * piece of text can match several; the result carries all of them so a moderator
 * (or the #32 enforcement layer) sees the full picture, not just the first hit.
 *
 * `sexual` is username-only: a bare explicit term keeps a *name* off the chat
 * surface (story 18) but is never flagged in chat, where adult sexual talk is
 * allowed (story 68) — chat only flags the `sexual_exploitation` carve-out.
 */
export type ModerationCategory =
  | "slur"
  | "threat"
  | "harassment"
  | "spam"
  | "underage"
  | "sexual_exploitation"
  | "sexual"
  | "contact_info"
  | "url"
  | "social_handle"
  | "reserved";

/**
 * How dangerous a match is, ordered. The enforcement slice (#32) maps these to
 * actions: `none` delivers normally; `low` warns or rate-limits a correctable
 * mistake (story 69); `high` is the PRD's "severe — skip warnings, auto-end and
 * escalate" tier (stories 70, 74). Kept as a small ordered union so callers can
 * compare tiers without a magic-number scale.
 */
export type ModerationSeverity = "none" | "low" | "high";

const SEVERITY_RANK: Record<ModerationSeverity, number> = {
  none: 0,
  low: 1,
  high: 2,
};

/** True when `a` is at least as severe as `b`. */
export function severityAtLeast(
  a: ModerationSeverity,
  b: ModerationSeverity,
): boolean {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b];
}

/** One rule that fired, with the category, its severity, and a label for review. */
export interface ModerationMatch {
  category: ModerationCategory;
  severity: ModerationSeverity;
  /** Short, stable identifier of the specific rule (not the raw user text). */
  rule: string;
}

/**
 * Structured verdict — never a bare boolean (issue #31 requires this so #32 can
 * build on it). `severity` is the max across all {@link matches}; `categories`
 * is the de-duplicated set of categories that fired. `blocked` is advisory: a
 * convenience the chat path can use to refuse delivery, true once any rule of at
 * least `low` severity matched. Callers wanting finer control read `severity`.
 */
export interface ModerationResult {
  severity: ModerationSeverity;
  categories: ModerationCategory[];
  matches: ModerationMatch[];
  /** Convenience: true when {@link severity} is `low` or `high`. */
  blocked: boolean;
}

/**
 * Curated slur fragments. Matched against the evasion-normalized "compact" form
 * (see {@link compact}) so "n-i-g-g-e-r" and "n.i.g.g.a" collapse to the token
 * we screen. Intentionally an MVP seed — small and high-confidence — not an
 * exhaustive list; the admin slices extend it. Slurs are always high severity:
 * the PRD treats hate as severe regardless of phrasing (story 74).
 */
const SLUR_FRAGMENTS = [
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "chink",
  "kike",
  "spic",
  "tranny",
  "coon",
  "wetback",
  "gook",
];

/**
 * Sexual-context tokens used only in combination — never on their own. Adult
 * sexual talk is allowed (story 68), so these are inert until paired with an
 * underage signal or a non-consent/force signal below. Kept compact-form.
 */
const SEXUAL_CONTEXT_FRAGMENTS = [
  "sex",
  "fuck",
  "nude",
  "nudes",
  "naked",
  "horny",
  "cum",
  "cock",
  "dick",
  "pussy",
  "blowjob",
  "anal",
  "porn",
  "masturbat",
  "jerkoff",
  "hookup",
  "sext",
];

/**
 * Underage signals. The presence of any of these *near* sexual context is the
 * line the PRD draws (story 68): not adult sexual talk, but anything tying it to
 * a minor. Matched on the compact form; numeric-age detection is handled
 * separately so "13" only counts as a problem alongside sexual context.
 */
const UNDERAGE_WORD_FRAGMENTS = [
  "underage",
  "preteen",
  "prepubescent",
  "childporn",
  "loli",
  "shota",
  "jailbait",
  "schoolgirl",
  "schoolboy",
  "littlegirl",
  "littleboy",
  "12yo",
  "13yo",
  "14yo",
  "15yo",
];

/**
 * Self-age statements pulled from the *original* text (not compact) so the digit
 * sits next to an age word. A stated age under 18 is an underage signal on its
 * own (it makes any subsequent sexual context exploitative) and, even without
 * sexual context, is a low-severity flag worth surfacing for review.
 */
const AGE_STATEMENT = /\b(?:i\s*am|i'?m|im|age)\s*(?:is\s*)?(\d{1,2})\b/i;
const AGE_WORD_STATEMENT =
  /\b(\d{1,2})\s*(?:years?\s*old|y(?:rs?)?\s*old|yo|y\/o)\b/i;

/**
 * Non-consent / force / coercion signals. Adult sexual content is allowed, but
 * the moment it is tied to force, coercion, or exploitation it is squarely in
 * the PRD's "illegal / non-consensual / exploitative" carve-out (story 68).
 */
const NON_CONSENT_FRAGMENTS = [
  "rape",
  "raping",
  "rapist",
  "molest",
  "incest",
  "bestiality",
  "noconsent",
  "withoutconsent",
  "againstyourwill",
  "forceyou",
  "forcedyou",
  "drugyou",
  "drugged",
];

/**
 * Credible-threat phrasing. Matched on the lowercased, space-normalized text so
 * we look at real phrases, not isolated words — "kill" alone is ordinary speech
 * ("this traffic is killing me"); "kill you" / "i will find you" is a threat.
 * High severity: the PRD wants threats interrupted immediately (story 70).
 */
const THREAT_PATTERNS: RegExp[] = [
  /\b(?:i(?:'?m| am| will| wll| gonna)?\s*(?:gonna|going to|will|gna)?\s*)?(?:kill|murder|stab|shoot|behead|strangle|choke|rape)\s+(?:you|u|ur|your|yo)\b/,
  /\bi(?:'?m| am| will| ll)?\s*(?:going to|gonna|gna)?\s*(?:find|hunt|track|come for|get)\s+(?:you|u|ur)\b/,
  /\b(?:hope|wish)\s+you\s+(?:die|burn|suffer)\b/,
  /\byou(?:'?re| are)\s+(?:gonna|going to)\s+die\b/,
  /\bi\s+know\s+where\s+you\s+live\b/,
  /\bwatch\s+your\s+back\b/,
];

/**
 * Targeted-harassment phrasing — a directed demand or slur-adjacent attack at
 * the partner. Low severity: it warrants a warning/rate-limit (story 69) rather
 * than an immediate auto-end, since harassment escalates over repetition (which
 * #32 tracks) where a single threat or slur does not.
 */
const HARASSMENT_PATTERNS: RegExp[] = [
  /\b(?:kill|hang|hurt)\s+your\s*self\b/,
  /\b(?:kys)\b/,
  /\byou\s+(?:are\s+|r\s+)?(?:a\s+)?(?:worthless|pathetic|disgusting|subhuman)\b/,
  /\b(?:nobody|no one)\s+(?:loves|likes|wants)\s+you\b/,
  /\bgo\s+(?:die|away and die)\b/,
];

/**
 * Spam / scam phrasing. The URL-spam *budget* lives in the rate limiter (story
 * 45); this catches the textual scam patterns that route a stranger to money or
 * off-platform regardless of whether a link is present. Low severity — a single
 * promotional message is a nuisance, not a danger.
 */
const SPAM_PATTERNS: RegExp[] = [
  /\b(?:free|cheap)\s+(?:followers|likes|subs|subscribers|crypto|bitcoin|nudes)\b/,
  /\b(?:click|tap)\s+(?:here|the link|my link|my bio)\b/,
  /\b(?:check|visit)\s+(?:out\s+)?my\s+(?:profile|bio|page|channel|stream)\b/,
  /\b(?:make|earn)\s+\$?\d+/,
  /\b(?:invest|investment)\s+(?:opportunity|now)\b/,
  /\bonly\s*fans\b/,
  /\bpromo\s*code\b/,
];

/**
 * Social-handle / off-platform-routing keywords (story 18). Matched on the
 * compact form so "i n s t a g r a m" and "insta.gram" still trip. For
 * usernames these are rejected outright; for chat they are a low-severity
 * spam-adjacent signal (sharing a handle is how scammers move strangers off
 * platform) but not on their own blocking.
 */
const SOCIAL_KEYWORDS = [
  "instagram",
  "snapchat",
  "telegram",
  "whatsapp",
  "discord",
  "tiktok",
  "onlyfans",
  "cashapp",
  "venmo",
  "paypal",
  "kik",
  "skype",
];

/** Username-only sexual fragments: names stay clean even where chat allows the word. */
const USERNAME_SEXUAL_FRAGMENTS = [
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
  "slut",
  "whore",
];

/** Username-only social keywords add a couple chat doesn't gate on by handle. */
const USERNAME_SOCIAL_KEYWORDS = [
  ...SOCIAL_KEYWORDS,
  "insta",
  "snap",
  "twitter",
  "reddit",
];

/**
 * Reserved platform/role terms a stranger must never impersonate (story 18).
 * Matched as whole words (and as the whole compact form) so "admin" is reserved
 * but "administrate my schedule" is not falsely a name collision.
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
  "fahchat",
];

/**
 * Evasion-resistant normal form: lowercase, fold common leetspeak digits to
 * their letters, then strip everything but letters and digits. Collapses
 * "f.u.c.k", "n i g g e r", and "n1gg3r" into the token we screen.
 */
function compact(value: string): string {
  return value
    .toLowerCase()
    .replace(/[4@]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9]/g, "");
}

/** Lowercased, single-spaced form for phrase/word matching. */
function normalizeSpaced(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Assemble a {@link ModerationResult} from the rules that fired: severity is the
 * max, categories are de-duplicated in first-seen order, and `blocked` is set
 * once anything reached `low`.
 */
function buildResult(matches: ModerationMatch[]): ModerationResult {
  let severity: ModerationSeverity = "none";
  const categories: ModerationCategory[] = [];
  for (const match of matches) {
    if (SEVERITY_RANK[match.severity] > SEVERITY_RANK[severity]) {
      severity = match.severity;
    }
    if (!categories.includes(match.category)) {
      categories.push(match.category);
    }
  }
  return {
    severity,
    categories,
    matches,
    blocked: severity !== "none",
  };
}

/**
 * Moderate a chat message (stories 66-68). Returns the structured verdict the
 * enforcement slice (#32) acts on. Crucially narrow: ordinary profanity and
 * consensual adult sexual talk produce `none`; only the enumerated harms flag.
 *
 *   - **Slurs** -> high (story 74).
 *   - **Threats** -> high (story 70).
 *   - **Underage + sexual context, or sexual + non-consent/force** -> high; this
 *     is the PRD's illegal/exploitative carve-out (story 68).
 *   - **Harassment, spam, lone underage age-statement, social-handle routing**
 *     -> low; correctable via warning/rate-limit (story 69).
 */
export function moderateText(raw: unknown): ModerationResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return buildResult([]);
  }

  const spaced = normalizeSpaced(raw);
  const flat = compact(raw);
  const matches: ModerationMatch[] = [];

  // Slurs — always high, matched on the evasion-normalized form.
  for (const frag of SLUR_FRAGMENTS) {
    if (flat.includes(frag)) {
      matches.push({ category: "slur", severity: "high", rule: `slur:${frag}` });
      break;
    }
  }

  // Threats — phrase-level, high.
  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(spaced)) {
      matches.push({ category: "threat", severity: "high", rule: "threat:phrase" });
      break;
    }
  }

  // Sexual context is computed once; it only matters in combination.
  const hasSexualContext = SEXUAL_CONTEXT_FRAGMENTS.some((f) => flat.includes(f));

  // Underage signals.
  const ageStatement = AGE_STATEMENT.exec(raw) ?? AGE_WORD_STATEMENT.exec(raw);
  const statedAge = ageStatement ? Number.parseInt(ageStatement[1], 10) : null;
  const hasUnderageWord = UNDERAGE_WORD_FRAGMENTS.some((f) => flat.includes(f));
  const hasUnderageAge = statedAge !== null && statedAge < 18;
  const hasUnderageSignal = hasUnderageWord || hasUnderageAge;

  if (hasUnderageSignal && hasSexualContext) {
    // Sexualizing a minor — the unambiguous illegal case. High.
    matches.push({
      category: "underage",
      severity: "high",
      rule: "underage:sexual_context",
    });
  } else if (hasUnderageSignal) {
    // An underage signal on its own: not blocked outright, but surfaced for
    // review so a moderator can weigh context (story 76).
    matches.push({ category: "underage", severity: "low", rule: "underage:signal" });
  }

  // Non-consent / force tied to sexual context -> exploitative, high. The
  // non-consent fragment itself (rape, incest, bestiality) is high regardless,
  // since those name the act, not merely allude to it.
  for (const frag of NON_CONSENT_FRAGMENTS) {
    if (flat.includes(frag)) {
      matches.push({
        category: "sexual_exploitation",
        severity: "high",
        rule: `non_consent:${frag}`,
      });
      break;
    }
  }

  // Harassment — directed attacks, low (escalates on repetition, tracked by #32).
  for (const pattern of HARASSMENT_PATTERNS) {
    if (pattern.test(spaced)) {
      matches.push({
        category: "harassment",
        severity: "low",
        rule: "harassment:phrase",
      });
      break;
    }
  }

  // Spam / scam phrasing, low.
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(spaced)) {
      matches.push({ category: "spam", severity: "low", rule: "spam:phrase" });
      break;
    }
  }

  // Social-handle off-platform routing, low (a scam vector, not on its own danger).
  if (SOCIAL_KEYWORDS.some((kw) => flat.includes(kw))) {
    matches.push({
      category: "social_handle",
      severity: "low",
      rule: "social_handle:keyword",
    });
  }

  return buildResult(matches);
}

/** Why a proposed display name was rejected; drives the user-facing message. */
export type UsernameRejectionCode =
  | "url"
  | "contact_info"
  | "social_handle"
  | "reserved"
  | "slur"
  | "sexual";

/**
 * Moderate a proposed username (story 18). Stricter than chat: a name must be
 * clean, so it rejects slurs, *any* sexual term, contact info, URLs, social
 * handles, and reserved platform terms. Returns the same structured shape as
 * {@link moderateText} so callers handle one result type; when blocked,
 * {@link UsernameRejectionCode} names the specific surface for the UI message.
 *
 * Length / charset validation stays in the identity layer (it owns the bounds
 * from {@link import("./index").productConfig}); this owns the *content* rules,
 * so the lexicon lives in exactly one place.
 */
export function moderateUsername(
  raw: unknown,
): ModerationResult & { rejectionCode: UsernameRejectionCode | null } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ...buildResult([]), rejectionCode: null };
  }

  const lower = raw.toLowerCase();
  const flat = compact(raw);
  const matches: ModerationMatch[] = [];
  let rejectionCode: UsernameRejectionCode | null = null;

  const fail = (
    category: ModerationCategory,
    code: UsernameRejectionCode,
    rule: string,
  ) => {
    matches.push({ category, severity: "high", rule });
    rejectionCode = rejectionCode ?? code;
  };

  // URLs / domains — reuse the shared URL detector so names and chat agree.
  if (containsUrlLike(raw) || /https?:\/\//.test(lower) || /\bwww\./.test(lower)) {
    fail("url", "url", "username:url");
  }

  // Contact info: emails, "@", or digit runs long enough to be a phone number.
  if (/@/.test(raw) || /\b\d[\d\s-]{4,}\d\b/.test(raw) || /\d{5,}/.test(flat)) {
    fail("contact_info", "contact_info", "username:contact_info");
  }

  // Social handles / off-platform routing.
  if (USERNAME_SOCIAL_KEYWORDS.some((kw) => flat.includes(kw))) {
    fail("social_handle", "social_handle", "username:social_handle");
  }

  // Reserved platform/role terms — whole-word or whole-compact-form match.
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (
    words.some((word) => RESERVED_WORDS.includes(word)) ||
    RESERVED_WORDS.some((w) => flat === w)
  ) {
    fail("reserved", "reserved", "username:reserved");
  }

  // Slurs.
  if (SLUR_FRAGMENTS.some((frag) => flat.includes(frag))) {
    fail("slur", "slur", "username:slur");
  }

  // Any explicit sexual term — names are held to a higher bar than chat.
  if (USERNAME_SEXUAL_FRAGMENTS.some((frag) => flat.includes(frag))) {
    fail("sexual", "sexual", "username:sexual");
  }

  return { ...buildResult(matches), rejectionCode };
}
