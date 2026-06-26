import { createHmac } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { AuthService } from "./auth.service";
import { InMemoryUserStore } from "./in-memory-user.store";
import { DevMockTokenVerifier, encodeMockGoogleToken } from "./google-token-verifier";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";

/** A feature-flags service seeded with the given disabled kill switches. */
function flagsWith(disabled: ("guest_access" | "queue_entry" | "camera_media" | "gender_filters")[] = []): FeatureFlagsService {
  return new FeatureFlagsService(
    new InMemoryFeatureFlagStore(disabled),
    new InMemoryFeatureFlagAuditLog()
  );
}

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
    service = new AuthService(store, new DevMockTokenVerifier(), flagsWith());
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

  describe("avatar change (stories 19-21)", () => {
    it("swaps the avatar, persists across logins, and starts the cooldown (stories 19, 22)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);

      const summary = await service.changeAvatar(token, "owl", "#10B981");
      expect(summary.identity.avatar).toEqual({ avatarId: "owl", backgroundColor: "#10B981" });
      expect(summary.avatarChange.allowed).toBe(false);

      // The new avatar persists with the account across a fresh login.
      const relogin = await service.loginWithGoogle(aliceToken);
      expect(relogin.summary.identity.avatar).toEqual({ avatarId: "owl", backgroundColor: "#10B981" });
      expect(relogin.summary.avatarChange.allowed).toBe(false);
    });

    it("validates the selection against the built-in set without consuming the cooldown", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await expect(service.changeAvatar(token, "dragon", "#10B981")).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect((await service.getUser(token))!.avatarChange.allowed).toBe(true);
    });

    it("enforces once-per-day and allows again after the window elapses", async () => {
      const { token, summary } = await service.loginWithGoogle(aliceToken);
      await service.changeAvatar(token, "cat", "#3B82F6");
      await expect(service.changeAvatar(token, "frog", "#8B5CF6")).rejects.toBeInstanceOf(
        ConflictException
      );

      const record = (await store.get(summary.userId))!;
      record.avatarUpdatedAt = new Date(
        Date.now() - (productConfig.avatarChangeCooldownHours + 1) * 3600_000
      ).toISOString();
      await store.save(record);

      const after = await service.changeAvatar(token, "frog", "#8B5CF6");
      expect(after.identity.avatar).toEqual({ avatarId: "frog", backgroundColor: "#8B5CF6" });
    });

    it("tracks the avatar cooldown independently of the name cooldown", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await service.changeDisplayName(token, "Velvet Sparrow");
      // Renaming consumed the name allowance but not the avatar one.
      const summary = await service.changeAvatar(token, "turtle", "#06B6D4");
      expect(summary.identity.displayName).toBe("Velvet Sparrow");
      expect(summary.identity.avatar).toEqual({ avatarId: "turtle", backgroundColor: "#06B6D4" });
    });

    it("requires a session", async () => {
      await expect(service.changeAvatar(undefined, "fox", "#EC4899")).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    });
  });

  describe("language + gender onboarding (stories 27-29)", () => {
    it("starts onboarding required with default preferences and no declared gender", async () => {
      const { summary } = await service.loginWithGoogle(aliceToken);
      expect(summary.onboarding.required).toBe(true);
      expect(summary.preferences).toEqual({
        uiLanguage: "en",
        matchingLanguage: "en",
        gender: null,
        // Gender filter defaults to "both" (no filtering) before onboarding.
        genderFilter: "both"
      });
    });

    it("saves matching language and gender, completing onboarding (stories 28-29)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);

      const summary = await service.setPreferences(token, "es", "female", undefined);
      expect(summary.onboarding.required).toBe(false);
      expect(summary.preferences.matchingLanguage).toBe("es");
      expect(summary.preferences.gender).toBe("female");
      // UI language defaults to the matching language when not supplied.
      expect(summary.preferences.uiLanguage).toBe("es");
    });

    it("keeps UI language and matching language as separate preferences (story 27)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);

      const summary = await service.setPreferences(token, "pt", "male", "en");
      expect(summary.preferences.matchingLanguage).toBe("pt");
      expect(summary.preferences.uiLanguage).toBe("en");
    });

    it("persists preferences across logins (story 22)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await service.setPreferences(token, "fr", "prefer_not_to_say", "de");

      const relogin = await service.loginWithGoogle(aliceToken);
      expect(relogin.summary.onboarding.required).toBe(false);
      expect(relogin.summary.preferences).toEqual({
        uiLanguage: "de",
        matchingLanguage: "fr",
        gender: "prefer_not_to_say",
        genderFilter: "both"
      });
    });

    it("rejects unsupported languages and invalid genders", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await expect(service.setPreferences(token, "klingon", "male", undefined)).rejects.toBeInstanceOf(
        BadRequestException
      );
      await expect(service.setPreferences(token, "en", "other", undefined)).rejects.toBeInstanceOf(
        BadRequestException
      );
      await expect(service.setPreferences(token, "en", "male", "klingon")).rejects.toBeInstanceOf(
        BadRequestException
      );
      // None of the rejected attempts completed onboarding.
      expect((await service.getUser(token))!.onboarding.required).toBe(true);
    });

    it("requires a session", async () => {
      await expect(service.setPreferences(undefined, "en", "male", undefined)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    });
  });

  describe("gender filter preference (stories 30-31)", () => {
    it("defaults to 'both' (no filtering) until the user narrows it", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      const summary = await service.setPreferences(token, "en", "male", undefined);
      expect(summary.preferences.genderFilter).toBe("both");
    });

    it("saves a chosen filter and persists it across logins (story 22)", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      const summary = await service.setPreferences(token, "en", "male", undefined, "female");
      expect(summary.preferences.genderFilter).toBe("female");

      const relogin = await service.loginWithGoogle(aliceToken);
      expect(relogin.summary.preferences.genderFilter).toBe("female");
    });

    it("leaves an existing filter untouched when omitted from a later edit", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await service.setPreferences(token, "en", "male", undefined, "male");
      // A later edit that only changes language must not reset the filter.
      const summary = await service.setPreferences(token, "es", "male", undefined);
      expect(summary.preferences.genderFilter).toBe("male");
    });

    it("rejects an unsupported gender filter without saving other changes", async () => {
      const { token } = await service.loginWithGoogle(aliceToken);
      await expect(
        service.setPreferences(token, "en", "male", undefined, "everyone")
      ).rejects.toBeInstanceOf(BadRequestException);
      // The rejected attempt did not complete onboarding either.
      expect((await service.getUser(token))!.onboarding.required).toBe(true);
    });

    it("blocks a narrowing filter when the gender_filters kill switch is off (story 84)", async () => {
      const killed = new AuthService(
        store,
        new DevMockTokenVerifier(),
        flagsWith(["gender_filters"])
      );
      const { token } = await killed.loginWithGoogle(aliceToken);
      await expect(
        killed.setPreferences(token, "en", "male", undefined, "female")
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      // Clearing the filter ("both") is still allowed even while disabled, so a
      // user can opt back out of a filter that matching is ignoring.
      const summary = await killed.setPreferences(token, "en", "male", undefined, "both");
      expect(summary.preferences.genderFilter).toBe("both");
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
