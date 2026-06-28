import type { ReportCategory, ReporterTrust } from "@fahhhchat/config";

/**
 * Where a moderator case sits in its lifecycle (issue #30, story 77). A case is
 * born `open` the instant a report is filed and stays in the review queue until a
 * moderator settles it; resolving it moves it to `resolved` so the queue keeps
 * only the work that still needs attention ("so that queues stay organized").
 * Enforcement actions a resolution might trigger (warnings/bans/appeals) are the
 * separate concern of issues #32/#36 — a case only records *that* it was settled
 * and how it was dispositioned, never carries out the punishment.
 */
export type CaseStatus = "open" | "resolved";

/**
 * The disposition a moderator records when resolving a case (issue #30, story 77).
 * `actioned` means the report led to enforcement (the actual action is logged by
 * the enforcement slice, issue #36); `dismissed` means it did not warrant any.
 * Kept a small closed set so the queue read and the admin surface (issue #35)
 * agree on outcomes without coupling to the enforcement action vocabulary.
 */
export type CaseOutcome = "actioned" | "dismissed";

/**
 * A moderator case opened from a filed report (issue #30, stories 65/76/77). It is
 * the unit of work a moderator triages: one case per report, carrying everything
 * the review queue needs to *prioritize* and *resolve* it without re-reading the
 * full report context (which the admin surface, issue #35, loads on demand via
 * {@link reportId}).
 *
 * Its {@link trustWeight} is frozen from the *reporter's* identity confidence at
 * creation (story 65) so the queue can be ordered logged-in-first without
 * re-deriving it, and so a later identity change can't silently reshuffle history.
 * It is a durable moderation record (retained ~1-2 years per the PRD), not
 * ephemeral realtime state — the same durability the report context it points at
 * has.
 */
export interface ModerationCase {
  /** Server-assigned id; the handle the admin surface (issue #35) acts against. */
  caseId: string;
  /**
   * The report this case was opened from — the {@link
   * import("../report-context/report-context.types").ReportContext.reportId}. One
   * case per report; the admin surface loads the full context (transcript, parties)
   * by this id rather than the case duplicating it.
   */
  reportId: string;
  /** The match the underlying report was filed in (already ended by case time). */
  matchId: string;
  /** Stable identity key (`kind:id`) of the user who filed the report. */
  reporterKey: string;
  /** Stable identity key (`kind:id`) of the user the case is about. */
  reportedKey: string;
  /** The category the report was filed under (issue #28, story 59). */
  category: ReportCategory;
  /**
   * The trust tier the report inherited from who filed it (story 65) — logged-in
   * reports rank above guest reports. Carried alongside {@link trustWeight} so the
   * admin surface can *show* the tier, not just sort by its number.
   */
  reporterTrust: ReporterTrust;
  /**
   * The frozen prioritization weight derived from {@link reporterTrust} at creation
   * ({@link import("@fahhhchat/config").reportTrustWeight}). Higher sorts earlier in
   * the open queue (story 65). Frozen rather than recomputed so the queue ordering
   * is stable and reproducible even if the weighting is retuned later.
   */
  trustWeight: number;
  /** Lifecycle state (story 77); `open` until a moderator resolves it. */
  status: CaseStatus;
  /** When the case was opened / the report filed (ISO 8601) — the queue tiebreaker. */
  openedAt: string;
  /**
   * The resolution, present only once {@link status} is `resolved` (story 77).
   * Records who settled it, when, and the disposition, so the queue can drop it and
   * the action stays accountable (issue #30 audit-logs nothing itself; issue #36's
   * enforcement slice owns the audit trail).
   */
  resolution?: CaseResolution;
}

/** The settlement recorded on a resolved case (issue #30, story 77). */
export interface CaseResolution {
  /** The disposition the moderator chose. */
  outcome: CaseOutcome;
  /** Identifier of the moderator who resolved it (admin id/email — issue #35). */
  resolvedBy: string;
  /** When it was resolved (ISO 8601). */
  resolvedAt: string;
  /** Optional free-text note the moderator left. */
  note?: string;
}

/**
 * What {@link import("./moderation-cases.service").ModerationCasesService.openFromReport}
 * needs to mint a {@link ModerationCase}: the report's stable facts plus the
 * reporter's trust tier (story 65). The chat layer assembles this from the captured
 * report context and the reporter's authenticated identity kind — never client
 * input — so the trust tier reflects who actually filed the report. The case id,
 * frozen weight, status, and timestamp are assigned by the service.
 */
export interface OpenCaseInput {
  reportId: string;
  matchId: string;
  reporterKey: string;
  reportedKey: string;
  category: ReportCategory;
  reporterTrust: ReporterTrust;
}

/**
 * What a moderator supplies to resolve a case (issue #30, story 77). The case id,
 * resolved-at timestamp, and the move to `resolved` are applied by the service.
 */
export interface ResolveCaseInput {
  outcome: CaseOutcome;
  /** Identifier of the moderator resolving it (admin id/email). */
  resolvedBy: string;
  /** Optional note; collapsed away when empty. */
  note?: string;
}

/**
 * Persistence contract for durable moderator cases (issue #30). Like report
 * context (and unlike the ephemeral chat buffer) a case is a durable moderation
 * record retained for the report-record window the PRD sets (~1-2 years), so it
 * belongs in the durable store, not Redis. Postgres is not wired in the repo yet,
 * so an in-memory implementation stands in for that backend (the same pattern the
 * admin / feature-flag / user / report-context stores use); swapping it later needs
 * no service change.
 */
export interface CaseStore {
  /**
   * Persist a {@link ModerationCase}, keyed by its {@link ModerationCase.caseId}.
   * Saving the same id again replaces the record (resolution writes the case back).
   */
  save(moderationCase: ModerationCase): Promise<void>;
  /** The case for a case id, or null if none exists. */
  findById(caseId: string): Promise<ModerationCase | null>;
  /**
   * The case opened from a given report id, or null. One case per report, so this
   * lets {@link import("./moderation-cases.service").ModerationCasesService} stay
   * idempotent — a retried report finds the existing case instead of opening a
   * duplicate.
   */
  findByReportId(reportId: string): Promise<ModerationCase | null>;
  /**
   * The `open` cases a moderator should triage, prioritized highest trust weight
   * first and, within a tier, newest first (story 65) — the review queue (story 76).
   * Resolved cases are excluded so the queue holds only outstanding work (story 77).
   */
  listOpen(): Promise<ModerationCase[]>;
  /**
   * Every case opened against a reported identity key, newest-first — the repeat-
   * abuse view a moderator (and the trust/enforcement slices) reads. Includes
   * resolved cases: prior outcomes are exactly what repeat-offense handling needs.
   */
  findByReportedKey(reportedKey: string): Promise<ModerationCase[]>;
}

export const CASE_STORE = Symbol("CASE_STORE");
