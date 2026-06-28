import type { ReportCategory } from "@fahhhchat/config";
import type { MatchRole } from "../chat/chat.types";

/**
 * Which party to a reported match authored a captured line of context — the
 * person who *filed* the report or the person being *reported*. The live chat
 * buffer tags each message with a neutral {@link MatchRole} (initiator /
 * responder), but a moderator evaluating an incident (story 62) cares only about
 * who is under review versus who flagged it, so context capture resolves the role
 * to this reporter-relative author the moment the report is filed.
 */
export type ReportContextAuthor = "reporter" | "reported";

/**
 * One line of the surrounding text context a report snapshots (issue #29, story
 * 62). It is a frozen copy of a {@link import("../chat/chat.types").ChatMessage}
 * from the match's live rolling buffer, re-tagged from the neutral match role to
 * a reporter-relative {@link author} so a moderator can read the exchange as
 * "reporter / reported" rather than "initiator / responder". Text only — image
 * bytes are never part of report context (the media-abuse slice, issue #44,
 * persists only metadata and this same surrounding text, never the media).
 */
export interface ReportContextMessage {
  /** The server message id carried on the live buffer entry (stable across capture). */
  messageId: string;
  /** Who sent it, relative to the report: the reporter or the reported user. */
  author: ReportContextAuthor;
  /** The message body, copied verbatim from the buffer. */
  text: string;
  /** The server send timestamp (ISO 8601) — preserves ordering for the moderator. */
  sentAt: string;
}

/**
 * A durable report-context record: the moderation evidence a report leaves behind
 * (issue #29, stories 62-64). It is written *only* when a report is filed (story
 * 63) — ordinary, unreported chats produce none and their rolling buffer simply
 * expires (story 64) — and it outlives the match (which is torn down immediately
 * on a report) so a moderator can review the incident later. Issue #30 reads this
 * to open a trust-weighted case; issue #35's admin surface renders it for review.
 *
 * It deliberately carries no live socket / routing state and no partner identity
 * beyond the stable `kind:id` keys: it is an archival snapshot, not part of the
 * realtime path.
 */
export interface ReportContext {
  /** Server-assigned id for this report (the handle a later case is opened against). */
  reportId: string;
  /** The match the report was filed in (already ended by the time this is read). */
  matchId: string;
  /** Stable identity key (`kind:id`) of the user who filed the report. */
  reporterKey: string;
  /** Stable identity key (`kind:id`) of the user being reported. */
  reportedKey: string;
  /** The normalised category the report was filed under (issue #28, story 59). */
  category: ReportCategory;
  /** Optional free-text the reporter added (issue #28, story 61); absent when none. */
  details?: string;
  /**
   * Whether the report also recorded a rematch-prevention block (issue #27, story
   * 56). Kept on the context so a moderator sees the protective action the reporter
   * already took, and a later case (issue #30) need not re-derive it.
   */
  alsoBlock: boolean;
  /** When the context was captured / the report filed (ISO 8601). */
  capturedAt: string;
  /**
   * The surrounding eligible text context, oldest-first (story 62). Empty when the
   * report was filed before any message was exchanged — a valid, if sparse, record:
   * a report must never fail to file for lack of context (mirroring issue #28's
   * "a report always succeeds" stance).
   */
  transcript: ReportContextMessage[];
}

/**
 * What {@link import("./report-context.service").ReportContextService.capture}
 * needs to build a {@link ReportContext}: the parties and form data the chat layer
 * already has in hand at report time, plus the snapshot of the live buffer to
 * freeze. The chat service passes the buffer in (read *before* it tears the match
 * down) and the reporter's match role so capture can re-tag each line's author.
 */
export interface CaptureReportContextInput {
  matchId: string;
  /** Identity key (`kind:id`) of the reporter (the caller of the report). */
  reporterKey: string;
  /** Identity key (`kind:id`) of the reported stranger. */
  reportedKey: string;
  /** The reporter's role within the match, so buffer lines can be tagged by author. */
  reporterRole: MatchRole;
  /** The normalised report category (issue #28). */
  category: ReportCategory;
  /** Optional normalised report details (issue #28); omit when none. */
  details?: string;
  /** Whether the report also recorded a rematch-prevention block (issue #27). */
  alsoBlock: boolean;
  /**
   * The match's live rolling buffer at report time, oldest-first — the raw
   * {@link import("../chat/chat.types").ChatMessage} entries. Capture re-tags and
   * trims these into the persisted {@link ReportContext.transcript}; passing the
   * buffer in (rather than the store reaching for it) keeps capture pure and lets
   * the caller read it before teardown drops it.
   */
  buffer: readonly BufferedLine[];
}

/**
 * The minimal shape capture needs from a live buffer entry — the fields it copies
 * into a {@link ReportContextMessage}. Structurally a subset of
 * {@link import("../chat/chat.types").ChatMessage}, declared here so the
 * report-context module does not depend on the full chat message type just to read
 * four fields.
 */
export interface BufferedLine {
  messageId: string;
  /** The neutral match role of the sender, resolved to an author at capture. */
  from: MatchRole;
  text: string;
  sentAt: string;
}

/**
 * Persistence contract for durable report-context records (issue #29). Unlike the
 * ephemeral chat buffer (Redis/in-memory, expires on match end), report context is
 * a *durable* moderation record retained for the report-record window the PRD sets
 * (~1-2 years), so it belongs in the same durable store as reports/cases. Postgres
 * is not wired in the repo yet, so an in-memory implementation stands in for that
 * durable backend (the same approach the admin/feature-flag/user stores take);
 * swapping it for a Postgres-backed store later needs no service change.
 */
export interface ReportContextStore {
  /**
   * Persist a captured {@link ReportContext}, keyed by its {@link
   * ReportContext.reportId}. Saving the same id again replaces the record (capture
   * mints a fresh id per report, so this only ever matters under a retry).
   */
  save(context: ReportContext): Promise<void>;
  /** The stored context for a report id, or null if none was ever captured. */
  findByReportId(reportId: string): Promise<ReportContext | null>;
  /**
   * Every context filed *against* a given reported identity key, newest-first.
   * Issue #30 weighs a user's report history; exposing the read by reported key now
   * gives that slice (and the admin surface) a query without reshaping the store.
   */
  findByReportedKey(reportedKey: string): Promise<ReportContext[]>;
}

export const REPORT_CONTEXT_STORE = Symbol("REPORT_CONTEXT_STORE");
