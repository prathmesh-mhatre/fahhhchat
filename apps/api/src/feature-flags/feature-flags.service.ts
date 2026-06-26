import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  defaultFeatureFlags,
  type FeatureFlagKey,
  type FeatureFlagState
} from "@fahhhchat/config";
import {
  FEATURE_FLAG_AUDIT_LOG,
  FEATURE_FLAG_CACHE_TTL_MS,
  FEATURE_FLAG_STORE,
  type FeatureFlagAuditEntry,
  type FeatureFlagAuditLog,
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
 * Every change is written through the {@link FeatureFlagAuditLog} so flag
 * changes are durable and traceable (story 85). The cache here is purely
 * time-based; *immediate* invalidation on a write is the remaining piece left to
 * issue #16, which is why a write still goes through the store rather than
 * mutating the cache in place.
 */
@Injectable()
export class FeatureFlagsService {
  private cache: CachedState | null = null;

  constructor(
    @Inject(FEATURE_FLAG_STORE) private readonly store: FeatureFlagStore,
    @Inject(FEATURE_FLAG_AUDIT_LOG) private readonly audit: FeatureFlagAuditLog
  ) {}

  /** Current enabled/disabled state for every flag (defaults + stored overrides). */
  async getState(): Promise<FeatureFlagState> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.state;
    }
    const state = await this.readState();
    this.cache = { state, expiresAt: now + FEATURE_FLAG_CACHE_TTL_MS };
    return state;
  }

  /** Read the merged state straight from the store, bypassing the cache. */
  private async readState(): Promise<FeatureFlagState> {
    return this.merge(await this.store.getAll());
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
   * Persist a kill-switch change and record it in the audit trail so the change
   * is durable and traceable (story 85). Returns the stored record. The cached
   * read is not invalidated here — it expires within
   * {@link FEATURE_FLAG_CACHE_TTL_MS}; immediate invalidation is issue #16. Admin
   * authorization for who may call this lands with the admin slices (#34-37);
   * `actor` carries attribution for the audit entry.
   */
  async setEnabled(
    key: FeatureFlagKey,
    enabled: boolean,
    actor: string | null = null
  ): Promise<FeatureFlagRecord> {
    // Capture the effective value before the change so the audit entry records
    // the transition (e.g. on -> off), not just the new state. Read uncached so
    // a write never warms the read cache with pre-write state.
    const previousEnabled = (await this.readState())[key];
    const record = await this.store.setEnabled(key, enabled, actor);
    await this.audit.record({
      key,
      previousEnabled,
      enabled: record.enabled,
      actor: record.updatedBy,
      changedAt: record.updatedAt
    });
    return record;
  }

  /** Full audit trail of flag changes, oldest first (story 85; traceability). */
  async auditTrail(): Promise<FeatureFlagAuditEntry[]> {
    return this.audit.list();
  }

  private merge(overrides: readonly FeatureFlagRecord[]): FeatureFlagState {
    const state: FeatureFlagState = { ...defaultFeatureFlags };
    for (const override of overrides) {
      state[override.key] = override.enabled;
    }
    return state;
  }
}
