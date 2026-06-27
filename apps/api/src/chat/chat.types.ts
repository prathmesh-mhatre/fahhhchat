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
 * match creation and updated on reconnect within the grace window (story 47).
 */
export interface ActiveMatchParticipant {
  /** Stable identity key (`kind:id`) used to look the participant's match up. */
  identityKey: string;
  /** Which side of the match this participant is. */
  role: MatchRole;
  /** Socket.IO id to deliver this participant's messages to. */
  socketId: string;
  /**
   * The participant's generated display name, resolved server-side at match
   * creation and frozen for the life of the match. The chat layer attaches the
   * *sender's* name to their typing indicator so the partner sees "Mellow Otter
   * is typing…" (story 40) — captured once here rather than re-resolved per
   * keystroke, and never trusted from the client.
   */
  displayName: string;
  /**
   * Whether this participant currently has a live socket. `false` while they are
   * inside the reconnect grace window (story 47): their old socket dropped but the
   * match is held open for a short same-session reconnect. A send to the partner
   * while they are away still buffers, so a returning participant catches up.
   */
  connected: boolean;
  /**
   * When the reconnect grace window for this participant lapses (ISO 8601), set
   * only while {@link connected} is `false`. A reconnect is honored only *before*
   * this instant; after it the match is torn down with `timeout`. Stored on the
   * record (not just in an in-process timer) so reconnect validity is decided by
   * the clock rather than by a timer that a multi-instance/crashed process may
   * never fire.
   */
  graceExpiresAt?: string;
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
 * sender so a client can stop retrying rather than hanging. `spam` is the
 * story-45 guardrail: the message was URL-like and the sender has exceeded their
 * link budget, so it is refused (not delivered) and the sender is told how long
 * to wait before another link will go through.
 */
export type SendResult =
  | { status: "delivered"; message: ChatMessage; recipientSocketId: string }
  | { status: "no_active_match" }
  | { status: "invalid"; reason: SendInvalidReason }
  | { status: "spam"; retryAfterSeconds: number };

/** Why a send was rejected as malformed, surfaced to the sender for messaging. */
export type SendInvalidReason = "empty" | "too_long";

/**
 * Why an active match ended, delivered to the still-connected partner so the web
 * app can explain the empty chat. `partner_disconnected` is a socket drop with no
 * grace left to spend (the partner was already away, or grace is disabled);
 * `timeout` is a reconnect grace window that lapsed without the partner returning
 * (story 47). The deliberate end reasons — Next, report, block — are added by
 * their own later slices (#26/#27) but share this event so the client handles
 * match-end uniformly.
 */
export type MatchEndReason = "partner_disconnected" | "timeout";

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
  /**
   * Mark the participant currently reachable on {@link socketId} as disconnected
   * and open their reconnect grace window until {@link graceExpiresAt} (story 47).
   * Drops the stale socket index so no send targets a dead socket, but keeps the
   * match and buffer alive so the participant can return. Returns the affected
   * match, the disconnected participant's identity key, and the partner — or null
   * if the socket was not in a live match (already torn down, or never chatting).
   */
  markDisconnected(
    socketId: string,
    graceExpiresAt: string,
  ): Promise<DisconnectMark | null>;
  /**
   * Re-bind the participant identified by {@link identityKey} to a fresh
   * {@link newSocketId}, clearing their disconnected/grace state, and re-index the
   * new socket for disconnect cleanup (story 47). Returns the updated match, or
   * null if the identity holds no live match (e.g. grace already lapsed and the
   * match was torn down). Idempotent for an already-connected participant.
   */
  reattach(
    identityKey: string,
    newSocketId: string,
  ): Promise<ActiveMatch | null>;
}

/**
 * The outcome of {@link ChatStore.markDisconnected}: the match a dropped socket
 * belonged to, the identity key of the participant that dropped, and the partner
 * on the other side, so the service can decide whether to hold grace (partner
 * still here) or tear down now (partner already gone).
 */
export interface DisconnectMark {
  match: ActiveMatch;
  /** Identity key of the participant whose socket dropped. */
  participantKey: string;
  /** The other participant, as recorded at the moment of disconnect. */
  partner: ActiveMatchParticipant;
}

export const CHAT_STORE = Symbol("CHAT_STORE");

/**
 * Resolves a {@link RealtimeIdentity} to its generated display name (story 40).
 * The name lives with the user's account or guest session, not on the realtime
 * socket, so the chat layer asks this seam once per match to learn each
 * participant's *server-authoritative* name — the only name a typing indicator
 * may show. Kept an interface so {@link import("./chat.service").ChatService}
 * stays unit-testable with a stub instead of the auth/session stores.
 */
export interface DisplayNameResolver {
  /** The identity's display name, or null when it can no longer be resolved. */
  resolve(identity: RealtimeIdentity): Promise<string | null>;
}

export const DISPLAY_NAME_RESOLVER = Symbol("DISPLAY_NAME_RESOLVER");

/**
 * Neutral fallback name used only when a participant's display name cannot be
 * resolved at match time (e.g. their guest session expired in the gap between
 * matching and registration). It keeps the typing indicator working rather than
 * leaking an empty name; in practice every matched user has a generated name.
 */
export const FALLBACK_DISPLAY_NAME = "Stranger";

/** Builds a stable identity key from a realtime identity (`kind:id`). */
export function chatIdentityKey(identity: RealtimeIdentity): string {
  return `${identity.kind}:${identity.id}`;
}

/**
 * Socket.IO event names for the chat surface (the realtime contract).
 *
 * Read receipts are *deliberately absent* (story 41): there is no "seen"/"read"
 * event in either direction. The MVP keeps text chat low-pressure, so the server
 * never tells a sender that the stranger has read their message — the only
 * sender-facing acknowledgement is {@link ack} (delivered to the server), never
 * a read confirmation. New events added here must not reintroduce one.
 */
export const CHAT_EVENTS = {
  /** Client → server: send a text message in the current match. */
  send: "chat:send",
  /** Server → sender: the message was accepted and delivered; carries its id. */
  ack: "chat:ack",
  /** Server → sender: the send was rejected; carries a machine-readable reason. */
  sendFailed: "chat:send-failed",
  /** Server → recipient: a new message from the stranger. */
  message: "chat:message",
  /**
   * Both directions: typing state for the current match (story 40). Client →
   * server carries only {@link TypingPayload.isTyping}; server → partner relays
   * it as {@link TypingIndicatorPayload}, stamped with the typing user's role and
   * generated display name so the partner can show "<name> is typing…".
   */
  typing: "chat:typing",
  /** Server → remaining participant(s): the match ended; chat is over. */
  matchEnded: "match:ended",
  /**
   * Client → server: a freshly reconnected socket asking to rejoin the match its
   * session was in (story 47). The server resolves the match from the socket's
   * authenticated identity — the client asserts nothing — and replies with
   * {@link resumed} or {@link resumeFailed}.
   */
  resume: "chat:resume",
  /**
   * Server → reconnecting client: the match was restored. Carries the client's
   * role and the recent {@link ChatMessage} buffer so it can repaint the
   * conversation it briefly dropped out of, plus whether the partner is presently
   * connected.
   */
  resumed: "chat:resumed",
  /**
   * Server → reconnecting client: there is no match to resume — the grace window
   * lapsed (or none existed). The client should return to the matching screen.
   */
  resumeFailed: "chat:resume-failed",
  /**
   * Server → partner: the other participant's socket dropped but the match is
   * being held open for a brief reconnect (story 47). Carries the grace length so
   * the partner's UI can show a "reconnecting…" hint rather than ending the chat.
   */
  partnerDisconnected: "match:partner-disconnected",
  /** Server → partner: the other participant reconnected within grace; chat resumes. */
  partnerReconnected: "match:partner-reconnected",
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
   * out of context. `empty`/`too_long` are validation failures. `spam` is the
   * story-45 link-flood guardrail — the message was URL-like and the sender is
   * over their link budget; retrying the same text immediately will fail again,
   * so the client surfaces a "slow down" hint rather than auto-retrying.
   */
  reason: "match_ended" | "spam" | SendInvalidReason;
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

/**
 * Server → reconnecting client payload for {@link CHAT_EVENTS.resumed}. Carries
 * the client's own role and the recent buffer so it can restore the conversation,
 * and whether the partner is currently connected so it can show the right
 * presence state on return.
 */
export interface ResumedPayload {
  matchId: string;
  role: MatchRole;
  /** Whether the partner currently has a live socket. */
  partnerConnected: boolean;
  /** The match's recent rolling buffer, oldest-first. */
  buffer: ChatMessage[];
}

/** Server → reconnecting client payload reporting there was no match to resume. */
export interface ResumeFailedPayload {
  reason: "no_active_match";
}

/**
 * Server → partner payload for {@link CHAT_EVENTS.partnerDisconnected}: the other
 * side dropped but the match is held open for {@link graceSeconds} for them to
 * reconnect (story 47).
 */
export interface PartnerDisconnectedPayload {
  matchId: string;
  graceSeconds: number;
}

/** Server → partner payload for {@link CHAT_EVENTS.partnerReconnected}. */
export interface PartnerReconnectedPayload {
  matchId: string;
}

/**
 * Client → server payload for {@link CHAT_EVENTS.typing}. The client asserts
 * only whether it is currently typing; the server resolves *who* is typing from
 * the authenticated socket, so a client can neither spoof another user's typing
 * state nor the name attached to it. Sent as a debounced start/stop toggle, not
 * per keystroke.
 */
export interface TypingPayload {
  isTyping: boolean;
}

/**
 * Server → partner payload for {@link CHAT_EVENTS.typing}, carrying the typing
 * user's match {@link from} role and their server-resolved generated
 * {@link displayName} so the partner can render "<displayName> is typing…"
 * (story 40). No message content and no read state — typing is the only
 * presence signal the chat surface exposes.
 */
export interface TypingIndicatorPayload {
  matchId: string;
  /** The typing participant's role within the match. */
  from: MatchRole;
  /** The typing participant's generated display name (never client-asserted). */
  displayName: string;
  /** Whether they are currently typing (start) or have stopped. */
  isTyping: boolean;
}

/**
 * Outcome of a typing toggle, returned by
 * {@link import("./chat.service").ChatService.typing}. `relay` carries the
 * partner's socket plus the typing user's role and name so the gateway can fan
 * the indicator out; `no_active_match` means the sender is not in a live match,
 * so there is nobody to notify and the toggle is dropped (the same match
 * boundary that guards message delivery — a stale typing event never leaks past
 * a match end).
 */
export type TypingResult =
  | {
      status: "relay";
      matchId: string;
      recipientSocketId: string;
      from: MatchRole;
      displayName: string;
      isTyping: boolean;
    }
  | { status: "no_active_match" };

/**
 * Outcome of a socket dropping while in a match, returned by
 * {@link import("./chat.service").ChatService.beginReconnectGrace}. `none` means
 * the socket held no live match (only ever queued, or already torn down). `grace`
 * means the match is held open for the dropped participant to reconnect: it
 * carries the grace deadline and the partner's socket so the gateway can arm a
 * teardown timer and tell the partner to wait (story 47). `ended` means there was
 * no grace to spend (the partner was already away) so the match was torn down
 * immediately, with the usual notify list.
 */
export type BeginReconnectGraceResult =
  | { status: "none" }
  | {
      status: "grace";
      matchId: string;
      /** Identity key of the participant who dropped (the one being waited for). */
      participantKey: string;
      /** When the grace window lapses (ISO 8601). */
      graceExpiresAt: string;
      /** The still-connected partner's socket, to send the "reconnecting" hint. */
      partnerSocketId: string;
    }
  | { status: "ended"; ended: EndedMatch };

/**
 * Outcome of a reconnect attempt, returned by
 * {@link import("./chat.service").ChatService.resume}. `resumed` means the match
 * was found within grace and re-bound to the new socket: it carries the role, the
 * recent buffer to repaint, and the partner's presence/socket so the gateway can
 * announce the return. `no_active_match` means there was nothing to resume; when
 * the grace window had lapsed but the match was still lingering, {@link ended}
 * carries the teardown so the gateway can also notify the partner.
 */
export type ResumeResult =
  | {
      status: "resumed";
      matchId: string;
      role: MatchRole;
      buffer: ChatMessage[];
      partnerConnected: boolean;
      partnerSocketId: string | null;
    }
  | { status: "no_active_match"; ended: EndedMatch | null };
