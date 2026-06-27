import { reportDefaultsAlsoBlock } from "@fahhhchat/config";

/**
 * The client half of the Report and Block safety actions (issue #27, stories
 * 52-56). Report and Block are *separate* controls (story 55): Block is a single
 * immediate action, while Report opens a small dialog whose only decision in this
 * slice is whether to *also block* the stranger (story 56) — the report
 * categories and optional details land in issue #28. This module is the pure
 * state for that dialog plus the helpers that turn either action into the payload
 * the chat view emits.
 *
 * Like {@link import("./two-step-next").TwoStepNext} and
 * {@link import("./outgoing-messages").OutgoingMessageTracker}, it is a
 * deliberately pure, framework-agnostic helper: no React, no sockets. A chat view
 * opens a report with {@link createReportDraft}, toggles the checkbox via
 * {@link setReportAlsoBlock}, and on submit emits the result of
 * {@link reportIntent}; a Block button emits {@link blockIntent} directly. The
 * "also block" box defaults from the shared {@link reportDefaultsAlsoBlock} so the
 * client and API agree on the protective default (story 56) — the same value the
 * API falls back to when a report omits the flag.
 */

/**
 * The mutable state of an open Report dialog. The only field is whether the
 * reporter has the "also block this user" option checked (story 56); who and
 * which match are resolved server-side from the authenticated socket, so the
 * client never carries them.
 */
export interface ReportDraft {
  /** Whether "also block this user" is checked. Defaults on (story 56). */
  alsoBlock: boolean;
}

/**
 * Open a fresh Report dialog with the "also block this user" option checked by
 * default (story 56), seeded from the shared {@link reportDefaultsAlsoBlock} so
 * the default matches what the API assumes when the flag is omitted.
 */
export function createReportDraft(): ReportDraft {
  return { alsoBlock: reportDefaultsAlsoBlock };
}

/**
 * Toggle the draft's "also block" choice, returning a new draft (the state is
 * immutable so a view can compare/replace it predictably). The reporter may
 * uncheck it to report *without* blocking (story 56).
 */
export function setReportAlsoBlock(
  draft: ReportDraft,
  alsoBlock: boolean,
): ReportDraft {
  return { ...draft, alsoBlock };
}

/**
 * The two safety actions, used to tag the {@link SafetyIntent} a view emits so the
 * realtime layer can route it to the right `match:report` / `match:block` event.
 */
export type SafetyActionKind = "report" | "block";

/**
 * The payload a chat view emits for a safety action. `report` carries the
 * reporter's also-block choice (the API treats an absent flag as the default, but
 * the client always knows its draft, so it sends the explicit value); `block`
 * carries nothing beyond its kind — the match and identities are server-resolved.
 */
export type SafetyIntent =
  | { kind: "report"; alsoBlock: boolean }
  | { kind: "block" };

/**
 * Build the intent for submitting a Report dialog. Carries the draft's explicit
 * {@link ReportDraft.alsoBlock} choice so the protective default is applied even
 * if the user never touched the checkbox (story 56).
 */
export function reportIntent(draft: ReportDraft): SafetyIntent {
  return { kind: "report", alsoBlock: draft.alsoBlock };
}

/**
 * Build the intent for the Block action — a single control with no options
 * (stories 53, 55). Blocking always ends the match and prevents immediate
 * rematch, so there is nothing for the user to configure.
 */
export function blockIntent(): SafetyIntent {
  return { kind: "block" };
}
