import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsentModule } from "../consent/consent.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SessionModule } from "../session/session.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [SessionModule, ConsentModule, AuthModule, RealtimeModule],
  controllers: [HealthController]
})
export class AppModule {}
