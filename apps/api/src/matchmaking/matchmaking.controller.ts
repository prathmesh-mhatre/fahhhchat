import { Controller, Get } from "@nestjs/common";
import { MatchmakingService } from "./matchmaking.service";
import type { QueueMetrics } from "./matchmaking.types";

/**
 * Internal queue-health metrics for operators (story 38). This is an *ops*
 * surface, not a product one: the PRD omits public online counts (story 37), so
 * `waiting` here must never be shown to end users. Like the feature-flags
 * surface, route-level authorization (admin login + roles) lands with the admin
 * slices (#34); until then this is documented as internal and intended to be
 * locked down there.
 */
@Controller("matchmaking")
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Get("metrics")
  async metrics(): Promise<QueueMetrics> {
    return this.matchmaking.metrics();
  }
}
