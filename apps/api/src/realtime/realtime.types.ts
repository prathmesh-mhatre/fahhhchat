/**
 * The authenticated identity a realtime (Socket.IO) connection carries. The PRD
 * models identity around an internal logged-in user id or a guest session id,
 * never the public Google identity — so a realtime client is exactly one of:
 *
 * - a logged-in account (`kind: "user"`, `id` = internal user id), or
 * - a guest session (`kind: "guest"`, `id` = guest session id).
 *
 * Matchmaking, chat, and moderation slices read this off the socket to scope
 * state and apply abuse controls.
 */
export type RealtimeIdentity =
  | { kind: "user"; id: string }
  | { kind: "guest"; id: string };

/**
 * Response from the handshake-token endpoint. The browser puts {@link token}
 * in the Socket.IO handshake `auth` payload; it is short-lived so a leaked
 * token cannot be replayed for long.
 */
export interface RealtimeTokenResponse {
  token: string;
  /** Seconds until the token expires, for the client to schedule a refresh. */
  expiresInSeconds: number;
  /** Absolute expiry (ISO 8601), convenient for logging/debugging. */
  expiresAt: string;
  /** The caller's own identity, echoed back for client-side display/state. */
  identity: RealtimeIdentity;
}

/**
 * Handshake tokens are deliberately short-lived: they only need to survive the
 * round trip from "fetch token" to "open socket". The PRD calls for short-lived
 * signed tokens for Socket.IO handshakes.
 */
export const REALTIME_HANDSHAKE_TTL_SECONDS = 60;
