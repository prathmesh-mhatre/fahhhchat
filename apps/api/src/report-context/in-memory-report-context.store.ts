import type { ReportContext, ReportContextStore } from "./report-context.types";

/**
 * Process-local durable-record stand-in for report context (issue #29). Report
 * context is a durable moderation record (retained ~1-2 years per the PRD), so in
 * production this is swapped for a Postgres-backed {@link ReportContextStore}
 * without touching {@link import("./report-context.service").ReportContextService}
 * — the same pattern the admin, feature-flag, and user stores use while the
 * database is not yet wired.
 *
 * Records are held by {@link ReportContext.reportId}; a secondary lookup by
 * reported identity scans the small set, which is fine for the in-memory dev/test
 * scale (the durable store will index it).
 */
export class InMemoryReportContextStore implements ReportContextStore {
  private readonly byReportId = new Map<string, ReportContext>();

  async save(context: ReportContext): Promise<void> {
    this.byReportId.set(context.reportId, context);
  }

  async findByReportId(reportId: string): Promise<ReportContext | null> {
    return this.byReportId.get(reportId) ?? null;
  }

  async findByReportedKey(reportedKey: string): Promise<ReportContext[]> {
    return [...this.byReportId.values()]
      .filter((context) => context.reportedKey === reportedKey)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
}
