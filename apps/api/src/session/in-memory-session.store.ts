import { GuestSessionRecord, GUEST_SESSION_TTL_SECONDS, SessionStore } from "./session.types";

interface StoredEntry {
  record: GuestSessionRecord;
  expiresAt: number;
}

/**
 * Process-local guest session store. Used in development and tests when no
 * `REDIS_URL` is configured. Sessions are lost on restart, which is acceptable
 * for ephemeral guest sessions but is why production uses Redis.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, StoredEntry>();

  constructor(private readonly ttlSeconds = GUEST_SESSION_TTL_SECONDS) {}

  async save(record: GuestSessionRecord): Promise<void> {
    this.entries.set(record.sessionId, {
      record,
      expiresAt: Date.now() + this.ttlSeconds * 1000
    });
  }

  async get(sessionId: string): Promise<GuestSessionRecord | null> {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(sessionId);
      return null;
    }
    return entry.record;
  }
}
