import { Module } from "@nestjs/common";
import { InMemoryModerationCasesStore } from "./in-memory-moderation-cases.store";
import { ModerationCasesService } from "./moderation-cases.service";
import { CASE_STORE, type CaseStore } from "./moderation-cases.types";

/**
 * Selects the moderator-case store. A case is a *durable* moderation record
 * (retained ~1-2 years per the PRD), not ephemeral realtime state, so — like the
 * report-context / admin / feature-flag / user stores and unlike the chat buffer
 * and matching queue — there is no Redis variant: the in-memory store stands in for
 * the Postgres-backed store that arrives when the database is wired.
 */
function createCaseStore(): CaseStore {
  return new InMemoryModerationCasesStore();
}

/**
 * Trust-weighted moderator cases (issue #30, stories 65/76/77). Owns the
 * {@link ModerationCasesService} over the store seam and exports it so the chat
 * layer can open a case the instant a report's context is captured, and so the
 * admin review surface (issue #35) and enforcement slice (issue #36) can read the
 * prioritized queue and resolve cases. It depends on nothing else, so it imports
 * cleanly into {@link import("../chat/chat.module").ChatModule} without a
 * dependency cycle — mirroring {@link
 * import("../report-context/report-context.module").ReportContextModule}.
 */
@Module({
  providers: [
    ModerationCasesService,
    { provide: CASE_STORE, useFactory: createCaseStore },
  ],
  exports: [ModerationCasesService],
})
export class ModerationCasesModule {}
