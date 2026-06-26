import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { MOCK_GOOGLE_TOKEN_PREFIX, encodeMockGoogleToken } from "@fahhhchat/config";
import type { GoogleIdentity } from "./auth.types";

/** Re-exported for tests; the encoder lives in the shared config package. */
export { encodeMockGoogleToken };

/**
 * Verifies a Google ID token (a Google-signed JWT obtained by NextAuth during
 * the OAuth exchange) and extracts the internal-use identity. The browser sends
 * the id token to the backend; the backend re-verifies it rather than trusting
 * the client's assertion of who they are.
 */
export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

const MOCK_PREFIX = MOCK_GOOGLE_TOKEN_PREFIX;

/**
 * Dev/test verifier used when real Google credentials are not configured
 * (`AUTH_DEV_MODE=true`). It accepts only the explicit `mock.` token format so a
 * genuine-looking but unverified Google token can never slip through this path.
 */
export class DevMockTokenVerifier implements GoogleTokenVerifier {
  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!idToken?.startsWith(MOCK_PREFIX)) {
      throw new UnauthorizedException("Invalid mock Google token.");
    }
    try {
      const json = Buffer.from(idToken.slice(MOCK_PREFIX.length), "base64url").toString("utf8");
      const parsed = JSON.parse(json) as Partial<GoogleIdentity>;
      if (typeof parsed.sub !== "string" || typeof parsed.email !== "string") {
        throw new Error("missing fields");
      }
      return { sub: parsed.sub, email: parsed.email };
    } catch {
      throw new UnauthorizedException("Invalid mock Google token.");
    }
  }
}

interface GoogleJwk {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty: string;
}

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Production verifier: validates the RS256 signature against Google's published
 * JWKS and checks issuer, audience, and expiry. Uses only Node's built-in crypto
 * and global fetch, so no extra dependency is needed.
 */
export class GoogleJwksVerifier implements GoogleTokenVerifier {
  private cachedKeys: Map<string, GoogleJwk> | null = null;
  private cacheExpiresAt = 0;

  constructor(private readonly audience: string) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw new UnauthorizedException("Malformed Google token.");
    }
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = this.decodeSegment(headerB64);
    if (header.alg !== "RS256") {
      throw new UnauthorizedException("Unsupported Google token algorithm.");
    }

    const jwk = await this.resolveKey(header.kid);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    const publicKey = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
    const signature = Buffer.from(signatureB64, "base64url");
    if (!verifier.verify(publicKey, signature)) {
      throw new UnauthorizedException("Google token signature is invalid.");
    }

    const payload = this.decodeSegment(payloadB64) as {
      iss?: string;
      aud?: string;
      exp?: number;
      sub?: string;
      email?: string;
    };
    if (!payload.iss || !GOOGLE_ISSUERS.includes(payload.iss)) {
      throw new UnauthorizedException("Unexpected Google token issuer.");
    }
    if (payload.aud !== this.audience) {
      throw new UnauthorizedException("Google token was issued for a different app.");
    }
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException("Google token has expired.");
    }
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      throw new UnauthorizedException("Google token is missing identity claims.");
    }
    return { sub: payload.sub, email: payload.email };
  }

  private decodeSegment(segment: string): Record<string, unknown> & { alg?: string; kid?: string } {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  }

  private async resolveKey(kid: string | undefined): Promise<GoogleJwk> {
    if (!kid) {
      throw new UnauthorizedException("Google token is missing a key id.");
    }
    if (!this.cachedKeys || Date.now() >= this.cacheExpiresAt) {
      await this.refreshKeys();
    }
    const jwk = this.cachedKeys?.get(kid);
    if (!jwk) {
      // The key may have rotated since the last fetch; refresh once more.
      await this.refreshKeys();
      const retried = this.cachedKeys?.get(kid);
      if (!retried) {
        throw new UnauthorizedException("Unknown Google signing key.");
      }
      return retried;
    }
    return jwk;
  }

  private async refreshKeys(): Promise<void> {
    const res = await fetch(GOOGLE_CERTS_URL);
    if (!res.ok) {
      throw new UnauthorizedException("Could not fetch Google signing keys.");
    }
    const body = (await res.json()) as { keys: GoogleJwk[] };
    this.cachedKeys = new Map(body.keys.map((key) => [key.kid, key]));

    // Respect Google's cache-control max-age so keys are refreshed on rotation.
    const maxAge = this.parseMaxAge(res.headers.get("cache-control"));
    this.cacheExpiresAt = Date.now() + maxAge * 1000;
  }

  private parseMaxAge(cacheControl: string | null): number {
    const match = cacheControl?.match(/max-age=(\d+)/);
    return match ? Number(match[1]) : 3600;
  }
}
