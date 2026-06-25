import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [SessionModule],
  controllers: [HealthController]
})
export class AppModule {}
