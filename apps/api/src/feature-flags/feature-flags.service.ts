import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  defaultFeatureFlags,
  type FeatureFlagKey,
  type FeatureFlagState
} from "@fahhhchat/config";
import {
  FEATURE_FLAG_CACHE_TTL_MS,
  FEATURE_FLAG_STORE,
  type FeatureFlagRecord,
  type FeatureFlagStore
} from "./feature-flags.types";

interface CachedState {
  state: FeatureFlagState;
  expiresAt: number;
}

/**
 * Evaluates the launch kill switches (stories 80, 84-85). Reads the durable
 * override store, merges it over {@link defaultFeatureFlags}, and caches the
 * merged state in-process for {@link FEATURE_FLAG_CACHE_TTL_MS} so hot paths
 * (queue entry, guest acceptance) don't hit the store on every request.
 *
 * The cache here is purely time-based; *immediate* invalidation on a write and
 * the durable audit log are deferred to issue #16, which is why a write still
 * goes through the store rather than mutating the cache in place.
 */
@Injectable()
export class FeatureFlagsService {
  private cache: CachedState | null = null;

  constructor(@Inject(FEATURE_FLAG_STORE) private readonly store: FeatureFlagStore) {}

  /** Current enabled/disabled state for every flag (defaults + stored overrides). */
  async getState(): Promise<FeatureFlagState> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.state;
    }
    const overrides = await this.store.getAll();
    const state = this.merge(overrides);
    this.cache = { state, expiresAt: now + FEATURE_FLAG_CACHE_TTL_MS };
    return state;
  }

  /** Whether a given surface is currently enabled. */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    return (await this.getState())[key];
  }

  /**
   * Throw a 503 when a surface is disabled, so a killed kill switch turns into a
   * clear "temporarily unavailable" at the gate. `message` lets each surface
   * explain itself (e.g. guest access vs. queue entry).
   */
  async assertEnabled(key: FeatureFlagKey, message: string): Promise<void> {
    if (!(await this.isEnabled(key))) {
      throw new ServiceUnavailableException(message);
    }
  }

  /**
   * Persist a kill-switch change. Returns the stored record. Note the cached
   * read is not invalidated here — it expires within
   * {@link FEATURE_FLAG_CACHE_TTL_MS}; immediate invalidation + audit logging are
   * issue #16. Admin authorization for who may call this lands with the admin
   * slices (#34-37); `actor` carries attribution for the audit trail.
   */
  async setEnabled(
    key: FeatureFlagKey,
    enabled: boolean,
    actor: string | null = null
  ): Promise<FeatureFlagRecord> {
    return this.store.setEnabled(key, enabled, actor);
  }

  private merge(overrides: readonly FeatureFlagRecord[]): FeatureFlagState {
    const state: FeatureFlagState = { ...defaultFeatureFlags };
    for (const override of overrides) {
      state[override.key] = override.enabled;
    }
    return state;
  }
}
