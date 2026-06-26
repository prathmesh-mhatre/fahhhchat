import type { FeatureFlagKey } from "@fahhhchat/config";

/**
 * Durable row for a feature flag *override*. Absence of a row means the flag is
 * at its {@link import("@fahhhchat/config").defaultFeatureFlags default} (on);
 * a row is written only when an operator flips a kill switch, so the store holds
 * the small set of surfaces that have ever been toggled rather than every key.
 *
 * `updatedBy` records who made the change for the audit trail. This slice
 * captures it on the record; the durable audit log and admin attribution land
 * with issue #16 / the admin slices, so it is nullable for system/seed changes.
 */
export interface FeatureFlagRecord {
  key: FeatureFlagKey;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Persistence contract for feature-flag overrides. Durable flag state belongs in
 * PostgreSQL per the PRD (admin configuration records); this slice ships the
 * contract with an in-memory implementation so the kill switches are demoable
 * and unit-testable, and a Postgres-backed store can drop in later without
 * touching {@link FeatureFlagsService}. Mirrors the store seam already used for
 * sessions (`SESSION_STORE`) and users (`USER_STORE`).
 */
export interface FeatureFlagStore {
  /** All stored overrides. Keys without a row are at their default. */
  getAll(): Promise<FeatureFlagRecord[]>;
  /** Upsert an override and return the persisted record. */
  setEnabled(key: FeatureFlagKey, enabled: boolean, actor: string | null): Promise<FeatureFlagRecord>;
}

export const FEATURE_FLAG_STORE = Symbol("FEATURE_FLAG_STORE");

/**
 * How long a read of the merged flag state is cached in-process before the store
 * is consulted again (story 85: cache feature flag reads). Kept short so a kill
 * switch flipped directly in the store still takes effect quickly; *immediate*
 * invalidation on write — and the audit log — arrive with issue #16.
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 30_000;
