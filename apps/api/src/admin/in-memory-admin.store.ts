import type { AdminRecord, AdminStore } from "./admin.types";

/**
 * Process-local admin store used in development and tests. Admin grants are
 * durable in production (Postgres per the PRD), so this is swapped for a
 * Postgres-backed {@link AdminStore} later without touching the service. Records
 * are indexed by lower-cased email — the allowlist key and the identity carried
 * on a logged-in account.
 */
export class InMemoryAdminStore implements AdminStore {
  private readonly byEmail = new Map<string, AdminRecord>();

  async findByEmail(email: string): Promise<AdminRecord | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }

  async save(record: AdminRecord): Promise<void> {
    this.byEmail.set(record.email.toLowerCase(), record);
  }

  async list(): Promise<AdminRecord[]> {
    return [...this.byEmail.values()];
  }
}
