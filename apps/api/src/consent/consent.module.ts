import { Module } from "@nestjs/common";
import { ConsentController } from "./consent.controller";
import { ConsentService } from "./consent.service";

/**
 * Region-aware cookie/privacy consent (issue #7). Self-contained: the decision
 * lives in a signed cookie, so no session store is required and the gate works
 * for any visitor. {@link ConsentService} is exported so the analytics slice
 * (#48) can consult the consent gate before emitting events.
 */
@Module({
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService]
})
export class ConsentModule {}
