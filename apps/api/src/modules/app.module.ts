import { Module } from "@nestjs/common";
import { ConsentModule } from "../consent/consent.module";
import { SessionModule } from "../session/session.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [SessionModule, ConsentModule],
  controllers: [HealthController]
})
export class AppModule {}
