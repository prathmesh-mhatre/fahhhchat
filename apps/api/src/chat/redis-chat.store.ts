import type { Redis } from "ioredis";
import { productConfig } from "@fahhhchat/config";
import type { ActiveMatch, ChatMessage, ChatStore } from "./chat.types";

/**
 * Redis-backed active-match + ephemeral buffer store, matching the PRD decision
 * to keep realtime/ephemeral chat state in Redis. Every key carries a TTL so an
 * orphaned match (e.g. the process crashed before a clean teardown) expires on
 * its own and never becomes durable history — the explicit teardown on
 * disconnect/end is the common path, the TTL is only a safety net.
 *
 * Layout (all under a `chat:` prefix):
 *   - `chat:match:{matchId}`      → JSON {@link ActiveMatch}
 *   - `chat:identity:{key}`       → matchId (route a send by sender identity)
 *   - `chat:socket:{socketId}`    → matchId (disconnect cleanup)
 *   - `chat:buffer:{matchId}`     → list of message JSON, capped to the rolling
 *                                   window via `LTRIM`
 */
export class RedisChatStore implements ChatStore {
  constructor(
    private readonly redis: Redis,
    private readonly bufferLimit: number = productConfig.chatBufferMaxMessages,
    /**
     * Safety-net TTL (seconds) for match state. The match normally ends well
     * before this via explicit teardown; the TTL only reaps state orphaned by a
     * crash so it can't linger as history.
     */
    private readonly ttlSeconds = 60 * 60,
  ) {}

  private matchKey(matchId: string): string {
    return `chat:match:${matchId}`;
  }

  private identityKey(key: string): string {
    return `chat:identity:${key}`;
  }

  private socketKey(socketId: string): string {
    return `chat:socket:${socketId}`;
  }

  private bufferKey(matchId: string): string {
    return `chat:buffer:${matchId}`;
  }

  async createMatch(match: ActiveMatch): Promise<void> {
    const tx = this.redis.multi();
    tx.set(
      this.matchKey(match.matchId),
      JSON.stringify(match),
      "EX",
      this.ttlSeconds,
    );
    // Start the buffer empty: a re-used matchId must not inherit stale messages.
    tx.del(this.bufferKey(match.matchId));
    for (const participant of match.participants) {
      tx.set(
        this.identityKey(participant.identityKey),
        match.matchId,
        "EX",
        this.ttlSeconds,
      );
      tx.set(
        this.socketKey(participant.socketId),
        match.matchId,
        "EX",
        this.ttlSeconds,
      );
    }
    await tx.exec();
  }

  async getMatchByIdentity(identityKey: string): Promise<ActiveMatch | null> {
    const matchId = await this.redis.get(this.identityKey(identityKey));
    return matchId ? this.getMatch(matchId) : null;
  }

  async getMatchBySocket(socketId: string): Promise<ActiveMatch | null> {
    const matchId = await this.redis.get(this.socketKey(socketId));
    return matchId ? this.getMatch(matchId) : null;
  }

  private async getMatch(matchId: string): Promise<ActiveMatch | null> {
    const raw = await this.redis.get(this.matchKey(matchId));
    return raw ? (JSON.parse(raw) as ActiveMatch) : null;
  }

  async appendMessage(matchId: string, message: ChatMessage): Promise<void> {
    // Only append to a match that still exists, so a message arriving just after
    // teardown can't resurrect a buffer with no owning match.
    if (!(await this.redis.exists(this.matchKey(matchId)))) {
      return;
    }
    const key = this.bufferKey(matchId);
    const tx = this.redis.multi();
    tx.rpush(key, JSON.stringify(message));
    // Keep only the newest window (negative indexes count from the tail).
    tx.ltrim(key, -this.bufferLimit, -1);
    tx.expire(key, this.ttlSeconds);
    await tx.exec();
  }

  async getBuffer(matchId: string): Promise<ChatMessage[]> {
    const raw = await this.redis.lrange(this.bufferKey(matchId), 0, -1);
    return raw.map((entry) => JSON.parse(entry) as ChatMessage);
  }

  async removeMatch(matchId: string): Promise<ActiveMatch | null> {
    const match = await this.getMatch(matchId);
    if (!match) {
      return null;
    }
    const tx = this.redis.multi();
    tx.del(this.matchKey(matchId));
    tx.del(this.bufferKey(matchId));
    for (const participant of match.participants) {
      tx.del(this.identityKey(participant.identityKey));
      tx.del(this.socketKey(participant.socketId));
    }
    await tx.exec();
    return match;
  }
}
