import type { UserRecord, UserStore } from "./auth.types";

/**
 * Process-local user store used in development and tests. Unlike guest sessions
 * (which are ephemeral by design), logged-in users are meant to be durable, so
 * production swaps this for a Postgres-backed {@link UserStore}. Records are
 * indexed by both internal id and Google subject for the two lookup paths.
 */
export class InMemoryUserStore implements UserStore {
  private readonly byUserId = new Map<string, UserRecord>();
  private readonly subToUserId = new Map<string, string>();

  async findByGoogleSub(googleSub: string): Promise<UserRecord | null> {
    const userId = this.subToUserId.get(googleSub);
    return userId ? (this.byUserId.get(userId) ?? null) : null;
  }

  async get(userId: string): Promise<UserRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async save(record: UserRecord): Promise<void> {
    this.byUserId.set(record.userId, record);
    this.subToUserId.set(record.googleSub, record.userId);
  }
}
