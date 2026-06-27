import {
  normalizeReportDetails,
  reportDefaultsAlsoBlock,
  type ReportCategory,
} from "@fahhhchat/config";

/**
 * The client half of the Report and Block safety actions (issue #27, stories
 * 52-56; issue #28, stories 59-61). Report and Block are *separate* controls
 * (story 55): Block is a single immediate action, while Report opens a small dialog
 * where the reporter picks a category (story 59), optionally adds free-text details
 * (story 61), and chooses whether to *also block* the stranger (story 56). A
 * category-only report — no details — is valid (story 60). This module is the pure
 * state for that dialog plus the helpers that turn either action into the intent
 * the chat view emits.
 *
 * Like {@link import("./two-step-next").TwoStepNext} and
 * {@link import("./outgoing-messages").OutgoingMessageTracker}, it is a
 * deliberately pure, framework-agnostic helper: no React, no sockets. A chat view
 * opens a report with {@link createReportDraft}, sets the category via
 * {@link setReportCategory}, edits details via {@link setReportDetails}, toggles the
 * checkbox via {@link setReportAlsoBlock}, gates its submit button on
 * {@link canSubmitReport}, and on submit emits {@link reportIntent}; a Block button
 * emits {@link blockIntent} directly. The "also block" box defaults from the shared
 * {@link reportDefaultsAlsoBlock} and details are normalised with the shared
 * {@link normalizeReportDetails} so the client and API agree on the protective
 * default and on what counts as empty/too-long details.
 */

/**
 * The mutable state of an open Report dialog. The reporter must pick a
 * {@link category} before the report can be filed (story 59); {@link details} is
 * optional free text (story 61); {@link alsoBlock} is the "also block this user"
 * choice (story 56). Who and which match are resolved server-side from the
 * authenticated socket, so the client never carries them.
 */
export interface ReportDraft {
  /** The chosen report category, or `null` until the reporter picks one (story 59). */
  category: ReportCategory | null;
  /** Free-text details as typed; optional (story 61). Normalised only on submit. */
  details: string;
  /** Whether "also block this user" is checked. Defaults on (story 56). */
  alsoBlock: boolean;
}

/**
 * Open a fresh Report dialog: no category chosen yet (the reporter must pick one,
 * story 59), empty details (story 61), and the "also block this user" option
 * checked by default (story 56), seeded from the shared {@link reportDefaultsAlsoBlock}
 * so the default matches what the API assumes when the flag is omitted.
 */
export function createReportDraft(): ReportDraft {
  return { category: null, details: "", alsoBlock: reportDefaultsAlsoBlock };
}

/**
 * Set the draft's report category (story 59), returning a new draft (the state is
 * immutable so a view can compare/replace it predictably).
 */
export function setReportCategory(
  draft: ReportDraft,
  category: ReportCategory,
): ReportDraft {
  return { ...draft, category };
}

/**
 * Replace the draft's free-text details (story 61). Stored verbatim as the reporter
 * types; trimming/length-capping happens once on submit via the shared
 * {@link normalizeReportDetails} so the field stays editable.
 */
export function setReportDetails(
  draft: ReportDraft,
  details: string,
): ReportDraft {
  return { ...draft, details };
}

/**
 * Toggle the draft's "also block" choice, returning a new draft. The reporter may
 * uncheck it to report *without* blocking (story 56).
 */
export function setReportAlsoBlock(
  draft: ReportDraft,
  alsoBlock: boolean,
): ReportDraft {
  return { ...draft, alsoBlock };
}

/**
 * Whether the draft can be submitted: a category must be chosen (story 59). Details
 * stay optional, so a category-only report is submittable (story 60). A view binds
 * its submit button's enabled state to this.
 */
export function canSubmitReport(draft: ReportDraft): boolean {
  return draft.category !== null;
}

/**
 * The two safety actions, used to tag the {@link SafetyIntent} a view emits so the
 * realtime layer can route it to the right `match:report` / `match:block` event.
 */
export type SafetyActionKind = "report" | "block";

/**
 * The payload a chat view emits for a safety action. `report` carries the chosen
 * {@link ReportCategory} (story 59), the reporter's also-block choice (story 56),
 * and — only when the reporter typed some — normalised {@link ReportIntent.details}
 * (story 61). `block` carries nothing beyond its kind — the match and identities
 * are server-resolved.
 */
export type SafetyIntent = ReportIntent | { kind: "block" };

/** The `report` variant of {@link SafetyIntent}. */
export interface ReportIntent {
  kind: "report";
  category: ReportCategory;
  alsoBlock: boolean;
  /** Present only when the reporter supplied non-empty details (story 61). */
  details?: string;
}

/**
 * Build the intent for submitting a Report dialog, or `null` when it is not yet
 * submittable (no category chosen — story 59), so a view can't file a category-less
 * report. Carries the draft's explicit {@link ReportDraft.alsoBlock} choice so the
 * protective default is applied even if the user never touched the checkbox (story
 * 56), and the normalised details, omitted entirely when blank (story 60) so a
 * category-only report sends no `details` field.
 */
export function reportIntent(draft: ReportDraft): ReportIntent | null {
  if (draft.category === null) {
    return null;
  }
  const details = normalizeReportDetails(draft.details);
  return {
    kind: "report",
    category: draft.category,
    alsoBlock: draft.alsoBlock,
    ...(details !== undefined ? { details } : {}),
  };
}

/**
 * Build the intent for the Block action — a single control with no options
 * (stories 53, 55). Blocking always ends the match and prevents immediate
 * rematch, so there is nothing for the user to configure.
 */
export function blockIntent(): SafetyIntent {
  return { kind: "block" };
}
