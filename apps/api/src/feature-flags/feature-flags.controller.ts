import { Controller, Get } from "@nestjs/common";
import type { FeatureFlagState } from "@fahhhchat/config";
import { FeatureFlagsService } from "./feature-flags.service";

@Controller("feature-flags")
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /**
   * Public, unauthenticated read of the current kill-switch state. The web apps
   * poll this to hide or lock a surface an operator has disabled (e.g. drop the
   * camera affordance when `camera_media` is off) — it exposes only on/off
   * booleans, never who changed a flag or why. Admin *management* of flags is a
   * separate, authorized surface (#37).
   */
  @Get()
  async state(): Promise<FeatureFlagState> {
    return this.flags.getState();
  }
}
