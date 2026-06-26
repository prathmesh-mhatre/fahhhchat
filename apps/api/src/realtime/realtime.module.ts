import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SessionModule } from "../session/session.module";
import { RealtimeController } from "./realtime.controller";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeTokenService } from "./realtime-token.service";

/**
 * Realtime access control: the token endpoint and the Socket.IO gateway that
 * authenticate guests and logged-in users for realtime. Reuses {@link AuthModule}
 * and {@link SessionModule} to resolve the caller's cookie identity, keeping the
 * single source of truth for what a valid guest/user is.
 */
@Module({
  imports: [AuthModule, SessionModule],
  controllers: [RealtimeController],
  providers: [RealtimeTokenService, RealtimeGateway],
  exports: [RealtimeTokenService],
})
export class RealtimeModule {}
