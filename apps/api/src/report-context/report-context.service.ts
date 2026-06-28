import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { reportContextMaxMessages } from "@fahhhchat/config";
import {
  REPORT_CONTEXT_STORE,
  type CaptureReportContextInput,
  type ReportContext,
  type ReportContextMessage,
  type ReportContextStore,
} from "./report-context.types";

/**
 * Captures and serves the durable text context a report leaves behind (issue #29,
 * stories 62-64). It is the single place that turns "a report was just filed" into
 * a persisted moderation record:
 *
 *   - **Capture only on report (story 63):** {@link capture} is called by the chat
 *     layer at the moment a report is filed and nowhere else, so ordinary chats —
 *     and plain blocks, which file no report — never produce a context record. The
 *     rolling buffer of an unreported chat simply expires with the match (story
 *     64); this service is what makes a *reported* chat's tail durable.
 *   - **Eligible surrounding context (story 62):** it snapshots the newest
 *     {@link reportContextMaxMessages} lines of the buffer the caller hands in,
 *     re-tagging each from the neutral match role to a reporter-relative author so
 *     a moderator reads "reporter / reported", and keeps text only (image bytes are
 *     never context).
 *
 * It assigns the report id, so the chat layer need not, and that id is the handle a
 * later trust-weighted case (issue #30) and the admin review surface (issue #35)
 * open against. All persistence lives behind the {@link ReportContextStore} seam,
 * keeping this service thin and unit-testable.
 */
@Injectable()
export class ReportContextService {
  constructor(
    @Inject(REPORT_CONTEXT_STORE) private readonly store: ReportContextStore,
  ) {}

  /**
   * Freeze the surrounding eligible text context for a freshly filed report and
   * persist it (stories 62-63), returning the stored {@link ReportContext} (whose
   * server-assigned {@link ReportContext.reportId} is the case handle). The caller
   * must pass the match's live buffer read *before* it tears the match down, since
   * teardown drops the buffer; this method does not reach for realtime state.
   *
   * The transcript is trimmed to the newest {@link reportContextMaxMessages} lines
   * (the buffer may already be smaller) and each line's author is resolved relative
   * to the reporter. An empty buffer yields an empty transcript — a valid record
   * (a report filed before any message), never a failure.
   */
  async capture(
    input: CaptureReportContextInput,
    now: Date = new Date(),
  ): Promise<ReportContext> {
    // Newest-N of the (oldest-first) buffer: the surrounding lead-up a moderator
    // needs, bounded so context never grows into stored history.
    const recent =
      input.buffer.length > reportContextMaxMessages
        ? input.buffer.slice(input.buffer.length - reportContextMaxMessages)
        : input.buffer;

    const transcript: ReportContextMessage[] = recent.map((line) => ({
      messageId: line.messageId,
      // Re-tag the neutral match role to reporter-relative authorship: a line from
      // the reporter's own role is "reporter", everything else is "reported".
      author: line.from === input.reporterRole ? "reporter" : "reported",
      text: line.text,
      sentAt: line.sentAt,
    }));

    const context: ReportContext = {
      reportId: randomUUID(),
      matchId: input.matchId,
      reporterKey: input.reporterKey,
      reportedKey: input.reportedKey,
      category: input.category,
      ...(input.details !== undefined ? { details: input.details } : {}),
      alsoBlock: input.alsoBlock,
      capturedAt: now.toISOString(),
      transcript,
    };
    await this.store.save(context);
    return context;
  }

  /** The stored context for a report id, or null — for issue #30 / #35 to read. */
  async forReport(reportId: string): Promise<ReportContext | null> {
    return this.store.findByReportId(reportId);
  }

  /**
   * Every context filed against a reported identity, newest-first. Issue #30 uses a
   * user's report history for trust weighting; exposed here so that slice has the
   * query without reshaping the store.
   */
  async forReported(reportedKey: string): Promise<ReportContext[]> {
    return this.store.findByReportedKey(reportedKey);
  }
}
