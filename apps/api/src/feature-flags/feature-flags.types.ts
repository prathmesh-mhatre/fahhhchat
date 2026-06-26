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
 * Append-only audit record for a single kill-switch change (story 85: flags are
 * stored "with caching and audit logs… so that changes are durable and
 * traceable"; PRD: "audit all feature flag/admin changes"). Captures the
 * effective value *before* and *after* the change so a reviewer can reconstruct
 * the timeline, plus who made it.
 */
export interface FeatureFlagAuditEntry {
  key: FeatureFlagKey;
  /** Effective value immediately before this change. */
  previousEnabled: boolean;
  /** Value the flag was set to. */
  enabled: boolean;
  /** Who made the change — an admin id, or "system" for boot/seed changes. */
  actor: string | null;
  changedAt: string;
}

/**
 * Durable audit trail for feature-flag changes. Lives in Postgres per the PRD
 * (audit records are retained); the in-memory implementation keeps the slice
 * demoable and lets the audit behavior be unit-tested in isolation. Kept
 * feature-flag scoped for this slice; the broader admin audit log (story 81)
 * can generalize this later.
 */
export interface FeatureFlagAuditLog {
  /** Append an entry. */
  record(entry: FeatureFlagAuditEntry): Promise<void>;
  /** Full history in chronological (oldest-first) order. */
  list(): Promise<FeatureFlagAuditEntry[]>;
}

export const FEATURE_FLAG_AUDIT_LOG = Symbol("FEATURE_FLAG_AUDIT_LOG");

/**
 * How long a read of the merged flag state is cached in-process before the store
 * is consulted again (story 85: cache feature flag reads). Kept short so a kill
 * switch flipped directly in the store still takes effect quickly; *immediate*
 * invalidation on write — and the audit log — arrive with issue #16.
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 30_000;
