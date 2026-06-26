import type { FeatureFlagAuditEntry, FeatureFlagAuditLog } from "./feature-flags.types";

/**
 * Process-local audit trail for feature-flag changes. Audit records are durable
 * per the PRD (admin/configuration changes are retained for traceability), so
 * production swaps this for a Postgres-backed {@link FeatureFlagAuditLog}; the
 * in-memory implementation keeps the kill switches demoable and lets the audit
 * behavior be unit-tested without a database.
 */
export class InMemoryFeatureFlagAuditLog implements FeatureFlagAuditLog {
  private readonly entries: FeatureFlagAuditEntry[] = [];

  async record(entry: FeatureFlagAuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async list(): Promise<FeatureFlagAuditEntry[]> {
    // Copy so callers can't mutate the log through the returned array.
    return [...this.entries];
  }
}
