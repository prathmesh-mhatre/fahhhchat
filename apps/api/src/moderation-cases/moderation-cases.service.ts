import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { reportTrustWeight } from "@fahhhchat/config";
import {
  CASE_STORE,
  type CaseStore,
  type ModerationCase,
  type OpenCaseInput,
  type ResolveCaseInput,
} from "./moderation-cases.types";

/**
 * Turns filed reports into the moderator queue (issue #30, stories 65/76/77). It
 * is the single place a report becomes a triageable case and the only place a case
 * is prioritized or resolved:
 *
 *   - **One trust-weighted case per report (story 65):** {@link openFromReport} is
 *     called the instant a report is captured and freezes the report's *reporter
 *     trust* into a prioritization weight — logged-in reports outrank guest reports,
 *     but a guest report still opens a case (it counts, never dropped). It is
 *     idempotent on the report id so a retried report reuses its existing case.
 *   - **A prioritized review queue (story 76):** {@link listOpen} returns the open
 *     cases highest-trust-first so a moderator reviews the most identity-confident
 *     reports first.
 *   - **Resolution to keep queues organized (story 77):** {@link resolve} settles a
 *     case so it leaves the open queue.
 *
 * It carries out no enforcement (warnings/bans/appeals are issues #32/#36) and
 * renders no UI (the admin surface is issue #35); it owns only the case lifecycle
 * over the {@link CaseStore} seam, so it is thin and unit-testable.
 */
@Injectable()
export class ModerationCasesService {
  constructor(@Inject(CASE_STORE) private readonly store: CaseStore) {}

  /**
   * Open a trust-weighted case from a freshly filed report (story 65), returning
   * it. The {@link OpenCaseInput.reporterTrust} the caller resolves from the
   * reporter's authenticated identity decides the frozen {@link
   * ModerationCase.trustWeight}, so the queue orders by who filed the report.
   *
   * Idempotent on {@link OpenCaseInput.reportId}: if a case already exists for that
   * report it is returned unchanged rather than a duplicate opened, keeping a report
   * retry (or a re-driven capture) from spawning two queue entries.
   */
  async openFromReport(
    input: OpenCaseInput,
    now: Date = new Date(),
  ): Promise<ModerationCase> {
    const existing = await this.store.findByReportId(input.reportId);
    if (existing) {
      return existing;
    }

    const moderationCase: ModerationCase = {
      caseId: randomUUID(),
      reportId: input.reportId,
      matchId: input.matchId,
      reporterKey: input.reporterKey,
      reportedKey: input.reportedKey,
      category: input.category,
      reporterTrust: input.reporterTrust,
      trustWeight: reportTrustWeight(input.reporterTrust),
      status: "open",
      openedAt: now.toISOString(),
    };
    await this.store.save(moderationCase);
    return moderationCase;
  }

  /** The case for an id, or null — for the admin surface (issue #35) to read. */
  async get(caseId: string): Promise<ModerationCase | null> {
    return this.store.findById(caseId);
  }

  /**
   * The open review queue, highest reporter-trust first (stories 65/76). The admin
   * surface (issue #35) renders this; exposed here so it need not re-implement the
   * ordering.
   */
  async listOpen(): Promise<ModerationCase[]> {
    return this.store.listOpen();
  }

  /**
   * Every case opened against a reported identity, newest-first — the repeat-abuse
   * history the trust/enforcement slices (issues #30 follow-ons) read.
   */
  async forReported(reportedKey: string): Promise<ModerationCase[]> {
    return this.store.findByReportedKey(reportedKey);
  }

  /**
   * Resolve an open case (story 77): record the disposition and move it out of the
   * open queue. Returns the updated case, or null if the id is unknown. Re-resolving
   * an already-resolved case simply overwrites its resolution — settling is
   * idempotent in effect, so a double-submit from the admin surface is safe.
   */
  async resolve(
    caseId: string,
    input: ResolveCaseInput,
    now: Date = new Date(),
  ): Promise<ModerationCase | null> {
    const existing = await this.store.findById(caseId);
    if (!existing) {
      return null;
    }
    const resolved: ModerationCase = {
      ...existing,
      status: "resolved",
      resolution: {
        outcome: input.outcome,
        resolvedBy: input.resolvedBy,
        resolvedAt: now.toISOString(),
        ...(input.note !== undefined && input.note.trim().length > 0
          ? { note: input.note.trim() }
          : {}),
      },
    };
    await this.store.save(resolved);
    return resolved;
  }
}
