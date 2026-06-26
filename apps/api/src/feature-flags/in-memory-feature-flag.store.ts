import type { FeatureFlagKey } from "@fahhhchat/config";
import type { FeatureFlagRecord, FeatureFlagStore } from "./feature-flags.types";

/**
 * Process-local feature-flag store used in development and tests. Flag overrides
 * are durable per the PRD (admin configuration), so production swaps this for a
 * Postgres-backed {@link FeatureFlagStore}; the in-memory implementation keeps
 * the kill switches demoable and unit-testable without standing up a database.
 *
 * Only *overridden* flags are stored — an absent key is at its default — so the
 * map starts empty and grows as switches are flipped.
 */
export class InMemoryFeatureFlagStore implements FeatureFlagStore {
  private readonly overrides = new Map<FeatureFlagKey, FeatureFlagRecord>();

  /**
   * Optionally seed disabled flags at construction (e.g. from a boot-time env
   * var) so an operator can launch with a surface already killed. Seeded rows
   * are attributed to "system".
   */
  constructor(disabledKeys: readonly FeatureFlagKey[] = []) {
    const now = new Date().toISOString();
    for (const key of disabledKeys) {
      this.overrides.set(key, { key, enabled: false, updatedAt: now, updatedBy: "system" });
    }
  }

  async getAll(): Promise<FeatureFlagRecord[]> {
    return [...this.overrides.values()];
  }

  async setEnabled(
    key: FeatureFlagKey,
    enabled: boolean,
    actor: string | null
  ): Promise<FeatureFlagRecord> {
    const record: FeatureFlagRecord = {
      key,
      enabled,
      updatedAt: new Date().toISOString(),
      updatedBy: actor
    };
    this.overrides.set(key, record);
    return record;
  }
}
