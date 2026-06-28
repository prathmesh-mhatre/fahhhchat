import { Module } from "@nestjs/common";
import { InMemoryReportContextStore } from "./in-memory-report-context.store";
import { ReportContextService } from "./report-context.service";
import {
  REPORT_CONTEXT_STORE,
  type ReportContextStore,
} from "./report-context.types";

/**
 * Selects the report-context store. Report context is a *durable* moderation
 * record (retained ~1-2 years per the PRD), not ephemeral realtime state, so —
 * unlike the chat buffer / matching queue — there is no Redis variant: the
 * in-memory store stands in for the Postgres-backed store that arrives when the
 * database is wired, mirroring the admin / feature-flag / user stores.
 */
function createReportContextStore(): ReportContextStore {
  return new InMemoryReportContextStore();
}

/**
 * Durable report-context capture (issue #29, stories 62-64). Owns the
 * {@link ReportContextService} over the store seam and exports it so the chat
 * layer can snapshot the surrounding eligible text context the instant a report is
 * filed (and only then). It depends on nothing else, so it imports cleanly into
 * {@link import("../chat/chat.module").ChatModule} without a dependency cycle; the
 * trust-weighted case slice (issue #30) and the admin review surface (issue #35)
 * will import it to read what was captured.
 */
@Module({
  providers: [
    ReportContextService,
    { provide: REPORT_CONTEXT_STORE, useFactory: createReportContextStore },
  ],
  exports: [ReportContextService],
})
export class ReportContextModule {}
