import { Module } from "@nestjs/common";
import { ModerationService } from "./moderation.service";

/**
 * Deterministic moderation rule engine (issue #31, stories 66-68). Exposes
 * {@link ModerationService} so the chat/realtime slices can classify messages
 * before delivery and the enforcement slice (#32) can map verdicts to actions.
 * The engine itself lives in `@fahhhchat/config` (shared with username
 * moderation); this module is only the DI seam, so it has no store or external
 * dependency to wire — unlike the rate-limit/session modules it needs no
 * Redis/in-memory backing.
 */
@Module({
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
