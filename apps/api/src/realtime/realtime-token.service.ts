import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  REALTIME_HANDSHAKE_TTL_SECONDS,
  type RealtimeIdentity,
  type RealtimeTokenResponse,
} from "./realtime.types";

/** Wire payload embedded in a handshake token before signing. */
interface TokenPayload {
  /** Identity kind: "u" (user) or "g" (guest), kept short to keep tokens small. */
  k: "u" | "g";
  id: string;
  /** Expiry as epoch seconds. */
  exp: number;
}

/**
 * Mints and verifies the short-lived, HMAC-signed tokens used for Socket.IO
 * handshakes (PRD: "use short-lived signed tokens for Socket.IO handshakes").
 *
 * A token is `base64url(payload).signature`, where the signature is an HMAC over
 * the encoded payload with a `realtime:` domain prefix so these tokens can never
 * be confused with the longer-lived app session / guest cookie tokens that share
 * `AUTH_SECRET`. Verification is constant-time and rejects expired or tampered
 * tokens, returning the embedded {@link RealtimeIdentity}.
 */
@Injectable()
export class RealtimeTokenService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "AUTH_SECRET must be set to sign realtime handshake tokens",
      );
    }
    this.secret = secret;
  }

  /** Issue a fresh short-lived token for the given identity. */
  issue(
    identity: RealtimeIdentity,
    now: Date = new Date(),
  ): RealtimeTokenResponse {
    const expSeconds =
      Math.floor(now.getTime() / 1000) + REALTIME_HANDSHAKE_TTL_SECONDS;
    const payload: TokenPayload = {
      k: identity.kind === "user" ? "u" : "g",
      id: identity.id,
      exp: expSeconds,
    };
    const encoded = this.encode(payload);
    return {
      token: `${encoded}.${this.signature(encoded)}`,
      expiresInSeconds: REALTIME_HANDSHAKE_TTL_SECONDS,
      expiresAt: new Date(expSeconds * 1000).toISOString(),
      identity,
    };
  }

  /**
   * Verify a handshake token's signature and expiry, returning the embedded
   * identity, or null if the token is missing, malformed, tampered, or expired.
   */
  verify(
    token: string | undefined,
    now: Date = new Date(),
  ): RealtimeIdentity | null {
    if (!token) {
      return null;
    }
    const lastDot = token.lastIndexOf(".");
    if (lastDot <= 0) {
      return null;
    }
    const encoded = token.slice(0, lastDot);
    const provided = Buffer.from(token.slice(lastDot + 1));
    const expected = Buffer.from(this.signature(encoded));
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }

    const payload = this.decode(encoded);
    if (!payload) {
      return null;
    }
    if (payload.exp * 1000 <= now.getTime()) {
      return null;
    }
    return { kind: payload.k === "u" ? "user" : "guest", id: payload.id };
  }

  private encode(payload: TokenPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
  }

  private decode(encoded: string): TokenPayload | null {
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        ((parsed as TokenPayload).k === "u" ||
          (parsed as TokenPayload).k === "g") &&
        typeof (parsed as TokenPayload).id === "string" &&
        typeof (parsed as TokenPayload).exp === "number"
      ) {
        return parsed as TokenPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  private signature(encodedPayload: string): string {
    return createHmac("sha256", this.secret)
      .update(`realtime:${encodedPayload}`)
      .digest("base64url");
  }
}
