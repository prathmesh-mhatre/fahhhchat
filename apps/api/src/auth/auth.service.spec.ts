import { createHmac } from "node:crypto";
import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { AuthService } from "./auth.service";
import { InMemoryUserStore } from "./in-memory-user.store";
import { DevMockTokenVerifier, encodeMockGoogleToken } from "./google-token-verifier";

/** Mint a valid app token for a user id, mirroring AuthService's signing scheme. */
function mintTokenFor(secret: string, userId: string): string {
  const signature = createHmac("sha256", secret).update(`user:${userId}`).digest("base64url");
  return `${userId}.${signature}`;
}

describe("AuthService", () => {
  let store: InMemoryUserStore;
  let service: AuthService;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  beforeEach(() => {
    store = new InMemoryUserStore();
    service = new AuthService(store, new DevMockTokenVerifier());
  });

  const aliceToken = encodeMockGoogleToken({ sub: "google-alice", email: "alice@example.com" });

  it("rejects login without a token", async () => {
    await expect(service.loginWithGoogle(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an unverifiable Google token", async () => {
    await expect(service.loginWithGoogle("not-a-mock-token")).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("creates a pseudonymous internal user and never exposes Google identity", async () => {
    const { token, summary } = await service.loginWithGoogle(aliceToken);

    expect(token).toContain(".");
    expect(summary.loggedIn).toBe(true);
    expect(summary.userId).toEqual(expect.any(String));
    // The Google identity must not leak into the client-facing summary.
    expect(JSON.stringify(summary)).not.toContain("alice@example.com");
    expect(JSON.stringify(summary)).not.toContain("google-alice");

    // But it is retained on the durable record for internal use.
    const record = (await store.get(summary.userId))!;
    expect(record.googleSub).toBe("google-alice");
    expect(record.email).toBe("alice@example.com");
  });

  it("keeps the same internal id and acceptance across logins (story 22)", async () => {
    const first = await service.loginWithGoogle(aliceToken);
    await service.acceptLegal(first.token, true, productConfig.legalVersion);
    await service.acceptSafety(first.token, productConfig.safetyGuidelinesVersion);

    const second = await service.loginWithGoogle(aliceToken);
    expect(second.summary.userId).toBe(first.summary.userId);
    expect(second.summary.legal.required).toBe(false);
    expect(second.summary.safety.required).toBe(false);
  });

  it("assigns a generated identity that persists across logins, never the Google identity (stories 14, 22)", async () => {
    const first = await service.loginWithGoogle(aliceToken);
    expect(first.summary.identity.displayName).toEqual(expect.any(String));
    expect(first.summary.identity.avatar.avatarId).toEqual(expect.any(String));
    // The generated identity must not embed the Google identity.
    expect(JSON.stringify(first.summary.identity)).not.toContain("alice");

    const second = await service.loginWithGoogle(aliceToken);
    expect(second.summary.identity).toEqual(first.summary.identity);
  });

  it("backfills a generated identity for accounts created before this slice", async () => {
    // Simulate a legacy record persisted without an identity.
    await store.save({
      userId: "legacy-user",
      googleSub: "google-legacy",
      email: "legacy@example.com",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    });
    const token = mintTokenFor("test-secret", "legacy-user");

    const user = await service.getUser(token);
    expect(user!.identity.displayName).toEqual(expect.any(String));

    // Backfill is persisted, so it stays stable on the next read.
    const again = await service.getUser(token);
    expect(again!.identity).toEqual(user!.identity);
  });

  it("gives different Google accounts different internal ids", async () => {
    const a = await service.loginWithGoogle(aliceToken);
    const b = await service.loginWithGoogle(
      encodeMockGoogleToken({ sub: "google-bob", email: "bob@example.com" })
    );
    expect(a.summary.userId).not.toBe(b.summary.userId);
  });

  it("requires legal/safety acceptance on a fresh account", async () => {
    const { summary } = await service.loginWithGoogle(aliceToken);
    expect(summary.legal).toMatchObject({ required: true, acceptedVersion: null });
    expect(summary.safety).toMatchObject({ required: true, reason: "first_time" });
  });

  it("persists legal acceptance and rejects a stale version", async () => {
    const { token } = await service.loginWithGoogle(aliceToken);

    await expect(service.acceptLegal(token, false, productConfig.legalVersion)).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(service.acceptLegal(token, true, "1999-old")).rejects.toBeInstanceOf(
      BadRequestException
    );

    const summary = await service.acceptLegal(token, true, productConfig.legalVersion);
    expect(summary.legal).toEqual({
      required: false,
      currentVersion: productConfig.legalVersion,
      acceptedVersion: productConfig.legalVersion
    });
  });

  it("re-prompts safety after an enforcement flag, then clears on re-acceptance", async () => {
    const { token } = await service.loginWithGoogle(aliceToken);
    await service.acceptSafety(token, productConfig.safetyGuidelinesVersion);

    await service.flagSafetyReprompt(token);
    expect((await service.getUser(token))!.safety).toMatchObject({
      required: true,
      reason: "enforcement"
    });

    await service.acceptSafety(token, productConfig.safetyGuidelinesVersion);
    expect((await service.getUser(token))!.safety).toMatchObject({ required: false, reason: null });
  });

  describe("display-name change (stories 16-18)", () => {
    it("renames the account, persists across logins, and starts the cooldown (stories 16, 22)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);

      const summary = await service.changeDisplayName(token, "  Velvet   Sparrow ");
      expect(summary.identity.displayName).toBe("Velvet Sparrow");
      expect(summary.displayNameChange.allowed).toBe(false);

      // The new name persists with the account across a fresh login.
      const relogin = await service.loginWithGoogle(aliceToken);
      expect(relogin.summary.identity.displayName).toBe("Velvet Sparrow");
      expect(relogin.summary.displayNameChange.allowed).toBe(false);
    });

    it("moderates the proposed name before saving (story 17-18)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await expect(service.changeDisplayName(token, "admin")).rejects.toBeInstanceOf(
        BadRequestException
      );
      // The rejected attempt did not consume the once-per-day allowance.
      expect((await service.getUser(token))!.displayNameChange.allowed).toBe(true);
    });

    it("enforces once-per-day and allows again after the window elapses", async () => {
      const { token, summary } = await service.loginWithGoogle(aliceToken);
      await service.changeDisplayName(token, "Amber Glacier");
      await expect(service.changeDisplayName(token, "Lucky Cipher")).rejects.toBeInstanceOf(
        ConflictException
      );

      // Simulate the last change happening just over a day ago.
      const record = (await store.get(summary.userId))!;
      record.displayNameUpdatedAt = new Date(
        Date.now() - (productConfig.displayNameChangeCooldownHours + 1) * 3600_000
      ).toISOString();
      await store.save(record);

      const after = await service.changeDisplayName(token, "Lucky Cipher");
      expect(after.identity.displayName).toBe("Lucky Cipher");
    });

    it("requires a session", async () => {
      await expect(service.changeDisplayName(undefined, "Brave Otter")).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    });
  });

  it("returns null and rejects for missing or tampered app tokens", async () => {
    const { token } = await service.loginWithGoogle(aliceToken);

    expect(await service.getUser(undefined)).toBeNull();
    expect(await service.getUser(`${token}tampered`)).toBeNull();
    await expect(service.acceptLegal(undefined, true, productConfig.legalVersion)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});
