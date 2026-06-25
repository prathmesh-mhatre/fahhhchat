import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { AuthService } from "./auth.service";
import { InMemoryUserStore } from "./in-memory-user.store";
import { DevMockTokenVerifier, encodeMockGoogleToken } from "./google-token-verifier";

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

  it("returns null and rejects for missing or tampered app tokens", async () => {
    const { token } = await service.loginWithGoogle(aliceToken);

    expect(await service.getUser(undefined)).toBeNull();
    expect(await service.getUser(`${token}tampered`)).toBeNull();
    await expect(service.acceptLegal(undefined, true, productConfig.legalVersion)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});
