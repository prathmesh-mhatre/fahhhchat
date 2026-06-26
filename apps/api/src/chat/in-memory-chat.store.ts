import { productConfig } from "@fahhhchat/config";
import type { ActiveMatch, ChatMessage, ChatStore } from "./chat.types";

interface StoredMatch {
  match: ActiveMatch;
  /** Newest-last ring of recent messages, capped at {@link bufferLimit}. */
  buffer: ChatMessage[];
}

/**
 * Process-local active-match + ephemeral buffer store. Used in development and
 * tests when no `REDIS_URL` is configured; production uses {@link
 * import("./redis-chat.store").RedisChatStore}. Everything here is intentionally
 * ephemeral — matches and their buffers live only in memory and vanish on
 * restart, which is exactly the lifetime the PRD wants for realtime chat state
 * (story 46, no durable chat history).
 *
 * The identity and socket indexes are derived views kept in lockstep with the
 * match map so a send (look up by identity) and a disconnect (look up by socket)
 * are both O(1) without scanning every match.
 */
export class InMemoryChatStore implements ChatStore {
  private readonly matches = new Map<string, StoredMatch>();
  private readonly byIdentity = new Map<string, string>();
  private readonly bySocket = new Map<string, string>();

  constructor(
    private readonly bufferLimit: number = productConfig.chatBufferMaxMessages,
  ) {}

  async createMatch(match: ActiveMatch): Promise<void> {
    this.matches.set(match.matchId, { match, buffer: [] });
    for (const participant of match.participants) {
      this.byIdentity.set(participant.identityKey, match.matchId);
      this.bySocket.set(participant.socketId, match.matchId);
    }
  }

  async getMatchByIdentity(identityKey: string): Promise<ActiveMatch | null> {
    const matchId = this.byIdentity.get(identityKey);
    return matchId ? (this.matches.get(matchId)?.match ?? null) : null;
  }

  async getMatchBySocket(socketId: string): Promise<ActiveMatch | null> {
    const matchId = this.bySocket.get(socketId);
    return matchId ? (this.matches.get(matchId)?.match ?? null) : null;
  }

  async appendMessage(matchId: string, message: ChatMessage): Promise<void> {
    const stored = this.matches.get(matchId);
    if (!stored) {
      return;
    }
    stored.buffer.push(message);
    // Keep only the newest window; drop the oldest once over the cap so the
    // buffer is a bounded rolling view, never growing into durable history.
    if (stored.buffer.length > this.bufferLimit) {
      stored.buffer.splice(0, stored.buffer.length - this.bufferLimit);
    }
  }

  async getBuffer(matchId: string): Promise<ChatMessage[]> {
    return [...(this.matches.get(matchId)?.buffer ?? [])];
  }

  async removeMatch(matchId: string): Promise<ActiveMatch | null> {
    const stored = this.matches.get(matchId);
    if (!stored) {
      return null;
    }
    this.matches.delete(matchId);
    for (const participant of stored.match.participants) {
      // Only clear an index entry if it still points at *this* match — a
      // participant who has since been re-indexed onto a newer match keeps it.
      if (this.byIdentity.get(participant.identityKey) === matchId) {
        this.byIdentity.delete(participant.identityKey);
      }
      if (this.bySocket.get(participant.socketId) === matchId) {
        this.bySocket.delete(participant.socketId);
      }
    }
    return stored.match;
  }
}
