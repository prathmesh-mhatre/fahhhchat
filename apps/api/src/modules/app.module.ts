import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { ConsentModule } from "../consent/consent.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";
import { MatchmakingModule } from "../matchmaking/matchmaking.module";
import { ModerationModule } from "../moderation/moderation.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SessionModule } from "../session/session.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    SessionModule,
    ConsentModule,
    AuthModule,
    RealtimeModule,
    FeatureFlagsModule,
    MatchmakingModule,
    ChatModule,
    ModerationModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
