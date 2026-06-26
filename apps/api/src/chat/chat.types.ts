import type { RealtimeIdentity } from "../realtime/realtime.types";

/**
 * Which side of a match a participant is — the same deterministic roles
 * matchmaking assigns ({@link import("../matchmaking/matchmaking.types").Match}):
 * the joiner who triggered the pair is the `initiator`, the one who was already
 * waiting is the `responder`. Chat carries the *role* (never the partner's raw
 * identity) on every delivered message so the recipient can tell their own
 * messages from the stranger's without the server ever exposing who the stranger
 * is — consistent with the PRD modelling identity around internal/guest ids only.
 */
export type MatchRole = "initiator" | "responder";

/**
 * One participant of an active match as the chat layer tracks them: their stable
 * {@link identityKey}, the role they hold, and the socket they are currently
 * reachable on. The socket is what a message is delivered to; it is captured at
 * match creation and (in later slices) updated on reconnect.
 */
export interface ActiveMatchParticipant {
  /** Stable identity key (`kind:id`) used to look the participant's match up. */
  identityKey: string;
  /** Which side of the match this participant is. */
  role: MatchRole;
  /** Socket.IO id to deliver this participant's messages to. */
  socketId: string;
}

/**
 * A live one-to-one match the chat layer is routing messages for. Created when
 * matchmaking pairs two users and dropped (with its buffer) the instant the match
 * ends, so it only ever describes a conversation that is currently happening —
 * the realtime half of the PRD's "chat history disappears when the match ends"
 * (story 46).
 */
export interface ActiveMatch {
  matchId: string;
  createdAt: string;
  participants: [ActiveMatchParticipant, ActiveMatchParticipant];
}

/**
 * A delivered chat message, as it appears to clients and in the ephemeral buffer.
 * The server is authoritative for {@link messageId} and {@link sentAt}: the
 * sender proposes only the text (and a correlation id), and the server stamps an
 * id and timestamp so ordering and acknowledgement come from one clock, not the
 * client's. {@link from} is the *sender's role*, never their identity, so a
 * recipient can place the bubble (mine vs. theirs) without learning who they are.
 */
export interface ChatMessage {
  matchId: string;
  /** Server-assigned unique message id (also the ack handle). */
  messageId: string;
  /** The sender's role within the match. */
  from: MatchRole;
  /** Message body, already trimmed and length-validated by the server. */
  text: string;
  /** Server send timestamp (ISO 8601) — the single source of ordering. */
  sentAt: string;
}

/**
 * Outcome of a send attempt, returned by
 * {@link import("./chat.service").ChatService.send}. `delivered` carries the
 * stamped {@link ChatMessage} plus the recipient's socket so the gateway can fan
 * it out and acknowledge the sender. The failure variants are the guardrails the
 * slice exists to enforce: `no_active_match` means the match has ended (or never
 * existed) so the message must *not* be delivered out of context (story 43), and
 * `invalid` means the text was empty or too long. Both are reported back to the
 * sender so a client can stop retrying rather than hanging.
 */
export type SendResult =
  | { status: "delivered"; message: ChatMessage; recipientSocketId: string }
  | { status: "no_active_match" }
  | { status: "invalid"; reason: SendInvalidReason };

/** Why a send was rejected as malformed, surfaced to the sender for messaging. */
export type SendInvalidReason = "empty" | "too_long";

/**
 * Why an active match ended, delivered to the still-connected partner so the web
 * app can explain the empty chat. This slice only produces `partner_disconnected`
 * (a socket dropped); the deliberate end reasons — Next, report, block, timeout —
 * are added by their own later slices (#26/#27/#25) but share this event so the
 * client handles match-end uniformly.
 */
export type MatchEndReason = "partner_disconnected";

/** The result of ending a match: who to notify, or null if it was already gone. */
export interface EndedMatch {
  matchId: string;
  reason: MatchEndReason;
  /**
   * Sockets of participants *other* than the one that triggered the end (e.g. the
   * partner of a disconnecting socket), to be told the match is over. Empty when
   * nobody remains to notify.
   */
  notifySocketIds: string[];
}

/**
 * Persistence contract for active-match routing state and the ephemeral
 * match-scoped message buffer. The PRD keeps realtime/ephemeral state in Redis,
 * so production wires a Redis implementation; an in-memory implementation keeps
 * the slice demoable and unit-testable without Redis — the same store seam used
 * for sessions, rate limits, and the matching queue.
 *
 * The store deliberately knows nothing about Socket.IO or validation; it is pure
 * state. {@link import("./chat.service").ChatService} composes these primitives
 * into the send / end flow.
 */
export interface ChatStore {
  /**
   * Register a freshly created match so its messages can be routed. Indexes the
   * match by id, by each participant's identity key, and by each participant's
   * socket id (for disconnect cleanup). Replaces any prior match held under the
   * same ids, which should not happen but keeps the store self-healing.
   */
  createMatch(match: ActiveMatch): Promise<void>;
  /** The active match a given identity is in, or null if they are not chatting. */
  getMatchByIdentity(identityKey: string): Promise<ActiveMatch | null>;
  /** The active match a given socket belongs to, or null. */
  getMatchBySocket(socketId: string): Promise<ActiveMatch | null>;
  /**
   * Append a message to the match's ephemeral buffer, trimming to the newest
   * {@link bufferLimit} so the buffer stays a bounded rolling window rather than
   * durable history. No-op if the match is gone.
   */
  appendMessage(matchId: string, message: ChatMessage): Promise<void>;
  /**
   * The match's current ephemeral buffer, oldest-first. Empty for an unknown or
   * ended match — history never outlives the match (story 46).
   */
  getBuffer(matchId: string): Promise<ChatMessage[]>;
  /**
   * Tear a match down: remove all its indexes and drop its buffer. Returns the
   * match that was removed (so the caller can decide whom to notify), or null if
   * it was already gone — making end idempotent under a disconnect/Next race.
   */
  removeMatch(matchId: string): Promise<ActiveMatch | null>;
}

export const CHAT_STORE = Symbol("CHAT_STORE");

/** Builds a stable identity key from a realtime identity (`kind:id`). */
export function chatIdentityKey(identity: RealtimeIdentity): string {
  return `${identity.kind}:${identity.id}`;
}

/** Socket.IO event names for the chat surface (the realtime contract). */
export const CHAT_EVENTS = {
  /** Client → server: send a text message in the current match. */
  send: "chat:send",
  /** Server → sender: the message was accepted and delivered; carries its id. */
  ack: "chat:ack",
  /** Server → sender: the send was rejected; carries a machine-readable reason. */
  sendFailed: "chat:send-failed",
  /** Server → recipient: a new message from the stranger. */
  message: "chat:message",
  /** Server → remaining participant(s): the match ended; chat is over. */
  matchEnded: "match:ended",
} as const;

/**
 * Client → server payload for {@link CHAT_EVENTS.send}. The client proposes only
 * the {@link text}; {@link clientMessageId} is an opaque correlation id the
 * client mints so it can match the server {@link AckPayload}/{@link
 * SendFailedPayload} back to the optimistic bubble it already rendered (and clear
 * or surface its retry state — stories 42-43). The server never trusts it for
 * anything but echoing it back.
 */
export interface SendMessagePayload {
  text: string;
  clientMessageId?: string;
}

/** Server → sender payload acknowledging a delivered message. */
export interface AckPayload {
  /** Echo of the sender's correlation id, if they supplied one. */
  clientMessageId?: string;
  /** Server-assigned message id. */
  messageId: string;
  /** Server send timestamp (ISO 8601). */
  sentAt: string;
}

/** Server → sender payload reporting a rejected send. */
export interface SendFailedPayload {
  /** Echo of the sender's correlation id, if they supplied one. */
  clientMessageId?: string;
  /**
   * Why the send failed. `match_ended` is the guardrail of story 43 — the match
   * is no longer active, so the client should stop retrying rather than deliver
   * out of context. `empty`/`too_long` are validation failures.
   */
  reason: "match_ended" | SendInvalidReason;
}

/** Server → recipient payload carrying a delivered message. */
export interface ChatMessagePayload {
  matchId: string;
  messageId: string;
  from: MatchRole;
  text: string;
  sentAt: string;
}

/** Server → remaining participant payload announcing a match ended. */
export interface MatchEndedPayload {
  matchId: string;
  reason: MatchEndReason;
}
