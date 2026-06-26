import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  type CustomDecorator
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FeatureFlagKey } from "@fahhhchat/config";
import { FeatureFlagsService } from "./feature-flags.service";

export const FEATURE_FLAG_METADATA = "feature_flag_required";

/**
 * Marks a route as gated by a launch kill switch: when the flag is off, the
 * route returns 503 before its handler runs. Pair with {@link FeatureFlagGuard}.
 * Used for surfaces that are whole routes (queue entry); surfaces that are one
 * field within a larger request (the gender filter) consult
 * {@link FeatureFlagsService} directly instead.
 */
export const RequireFeatureFlag = (key: FeatureFlagKey): CustomDecorator =>
  SetMetadata(FEATURE_FLAG_METADATA, key);

/**
 * Enforces the {@link RequireFeatureFlag} decorator. A route without the
 * decorator is allowed through, so the guard is safe to apply broadly.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<FeatureFlagKey | undefined>(
      FEATURE_FLAG_METADATA,
      [context.getHandler(), context.getClass()]
    );
    if (!key) {
      return true;
    }
    await this.flags.assertEnabled(key, "This feature is temporarily unavailable. Please try again later.");
    return true;
  }
}
