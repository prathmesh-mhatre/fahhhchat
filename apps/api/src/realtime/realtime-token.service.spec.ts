import { RealtimeTokenService } from "./realtime-token.service";
import {
  REALTIME_HANDSHAKE_TTL_SECONDS,
  type RealtimeIdentity,
} from "./realtime.types";

describe("RealtimeTokenService", () => {
  let service: RealtimeTokenService;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  beforeEach(() => {
    service = new RealtimeTokenService();
  });

  const guest: RealtimeIdentity = { kind: "guest", id: "guest-123" };
  const user: RealtimeIdentity = { kind: "user", id: "user-abc" };

  it("issues a signed, short-lived token that round-trips back to the identity", () => {
    const result = service.issue(guest);

    expect(result.token).toContain(".");
    expect(result.expiresInSeconds).toBe(REALTIME_HANDSHAKE_TTL_SECONDS);
    expect(result.identity).toEqual(guest);
    expect(service.verify(result.token)).toEqual(guest);
  });

  it("preserves the identity kind for logged-in users", () => {
    const { token } = service.issue(user);
    expect(service.verify(token)).toEqual(user);
  });

  it("returns null for missing, malformed, or unsigned tokens", () => {
    expect(service.verify(undefined)).toBeNull();
    expect(service.verify("")).toBeNull();
    expect(service.verify("no-dot")).toBeNull();
    expect(service.verify(".onlysig")).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const { token } = service.issue(user);
    const [payload, sig] = token.split(".");

    expect(service.verify(`${payload}.${sig}tampered`)).toBeNull();
    // Re-encode a different identity but keep the original signature.
    const forged = Buffer.from(
      JSON.stringify({ k: "u", id: "someone-else", exp: 9999999999 }),
    ).toString("base64url");
    expect(service.verify(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const issuedAt = new Date("2026-06-26T00:00:00.000Z");
    const { token } = service.issue(guest, issuedAt);

    const justAfterExpiry = new Date(
      issuedAt.getTime() + (REALTIME_HANDSHAKE_TTL_SECONDS + 1) * 1000,
    );
    expect(service.verify(token, justAfterExpiry)).toBeNull();

    const beforeExpiry = new Date(
      issuedAt.getTime() + (REALTIME_HANDSHAKE_TTL_SECONDS - 1) * 1000,
    );
    expect(service.verify(token, beforeExpiry)).toEqual(guest);
  });

  it("does not accept tokens signed with a different secret", () => {
    const { token } = service.issue(user);

    process.env.AUTH_SECRET = "rotated-secret";
    const rotated = new RealtimeTokenService();
    process.env.AUTH_SECRET = "test-secret";

    expect(rotated.verify(token)).toBeNull();
  });
});
