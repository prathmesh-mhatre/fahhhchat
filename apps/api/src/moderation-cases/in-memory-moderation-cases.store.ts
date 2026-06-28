import type { CaseStore, ModerationCase } from "./moderation-cases.types";

/**
 * Process-local durable-record stand-in for moderator cases (issue #30). A case is
 * a durable moderation record (retained ~1-2 years per the PRD), so in production
 * this is swapped for a Postgres-backed {@link CaseStore} without touching
 * {@link import("./moderation-cases.service").ModerationCasesService} — the same
 * pattern the admin, feature-flag, user, and report-context stores use while the
 * database is not yet wired.
 *
 * Records are held by {@link ModerationCase.caseId}; the report-id and reported-key
 * lookups and the prioritized open-queue scan walk the small map, which is fine at
 * the in-memory dev/test scale (the durable store will index and order these).
 */
export class InMemoryModerationCasesStore implements CaseStore {
  private readonly byCaseId = new Map<string, ModerationCase>();

  async save(moderationCase: ModerationCase): Promise<void> {
    this.byCaseId.set(moderationCase.caseId, moderationCase);
  }

  async findById(caseId: string): Promise<ModerationCase | null> {
    return this.byCaseId.get(caseId) ?? null;
  }

  async findByReportId(reportId: string): Promise<ModerationCase | null> {
    for (const moderationCase of this.byCaseId.values()) {
      if (moderationCase.reportId === reportId) {
        return moderationCase;
      }
    }
    return null;
  }

  async listOpen(): Promise<ModerationCase[]> {
    return [...this.byCaseId.values()]
      .filter((moderationCase) => moderationCase.status === "open")
      .sort(byPriority);
  }

  async findByReportedKey(reportedKey: string): Promise<ModerationCase[]> {
    return [...this.byCaseId.values()]
      .filter((moderationCase) => moderationCase.reportedKey === reportedKey)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }
}

/**
 * Open-queue ordering (issue #30, story 65): highest trust weight first so
 * logged-in reports surface above guest reports, and within a tier the newest case
 * first so a fresh incident is not buried behind older same-tier ones.
 */
function byPriority(a: ModerationCase, b: ModerationCase): number {
  if (a.trustWeight !== b.trustWeight) {
    return b.trustWeight - a.trustWeight;
  }
  return b.openedAt.localeCompare(a.openedAt);
}
