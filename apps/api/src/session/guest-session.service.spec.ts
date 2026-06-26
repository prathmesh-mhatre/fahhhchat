import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { GuestSessionService } from "./guest-session.service";
import { InMemorySessionStore } from "./in-memory-session.store";
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

describe("GuestSessionService", () => {
  let store: InMemorySessionStore;
  let service: GuestSessionService;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  beforeEach(() => {
    store = new InMemorySessionStore();
    service = new GuestSessionService(store, flagsWith());
  });

  it("rejects acceptance when 18+ is not confirmed", async () => {
    await expect(
      service.accept({ ageConfirmed: false, legalVersion: productConfig.legalVersion })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects guest acceptance when the guest_access kill switch is off (story 84)", async () => {
    const killed = new GuestSessionService(store, flagsWith(["guest_access"]));
    await expect(
      killed.accept({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("rejects acceptance for a stale legal version", async () => {
    await expect(
      service.accept({ ageConfirmed: true, legalVersion: "1999-old" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a valid submission and persists the version and timestamp", async () => {
    const { token, summary } = await service.accept({
      ageConfirmed: true,
      legalVersion: productConfig.legalVersion
    });

    expect(token).toContain(".");
    expect(summary).toEqual({
      accepted: true,
      legalVersion: productConfig.legalVersion,
      acceptedAt: expect.any(String),
      identity: {
        displayName: expect.any(String),
        avatar: { avatarId: expect.any(String), backgroundColor: expect.any(String) }
      },
      displayNameChange: { allowed: true, nextAllowedAt: null },
      avatarChange: { allowed: true, nextAllowedAt: null },
      safety: {
        required: true,
        currentVersion: productConfig.safetyGuidelinesVersion,
        acceptedVersion: null,
        reason: "first_time"
      }
    });

    const resolved = await service.getSession(token);
    expect(resolved).toEqual(summary);
  });

  it("assigns a session-scoped generated identity that stays stable for the session (stories 13, 23)", async () => {
    const { token, summary } = await service.accept({
      ageConfirmed: true,
      legalVersion: productConfig.legalVersion
    });

    expect(summary.identity.displayName).toEqual(expect.any(String));
    expect(summary.identity.avatar.avatarId).toEqual(expect.any(String));

    // The same session keeps the same identity across reads (it is persisted on
    // the session record, not regenerated per request).
    const resolved = await service.getSession(token);
    expect(resolved!.identity).toEqual(summary.identity);
  });

  it("returns null for a missing or tampered token", async () => {
    const { token } = await service.accept({
      ageConfirmed: true,
      legalVersion: productConfig.legalVersion
    });

    expect(await service.getSession(undefined)).toBeNull();
    expect(await service.getSession(`${token}tampered`)).toBeNull();
  });

  it("returns null when the signed session is unknown to the store", async () => {
    // A correctly signed token whose record was never saved (e.g. expired/evicted).
    const orphan = new GuestSessionService(new InMemorySessionStore(), flagsWith());
    const { token } = await orphan.accept({
      ageConfirmed: true,
      legalVersion: productConfig.legalVersion
    });

    expect(await service.getSession(token)).toBeNull();
  });

  describe("display-name change (stories 16-18)", () => {
    async function newSession() {
      const { token } = await service.accept({
        ageConfirmed: true,
        legalVersion: productConfig.legalVersion
      });
      return token;
    }

    it("renames the session, normalizes the name, and starts the cooldown", async () => {
      const token = await newSession();

      const summary = await service.changeDisplayName(token, "  Cool   Wanderer  ");
      expect(summary.identity.displayName).toBe("Cool Wanderer");
      expect(summary.displayNameChange.allowed).toBe(false);
      expect(summary.displayNameChange.nextAllowedAt).toEqual(expect.any(String));

      // Persisted for the session.
      const resolved = await service.getSession(token);
      expect(resolved!.identity.displayName).toBe("Cool Wanderer");
    });

    it("leaves the avatar untouched when renaming", async () => {
      const token = await newSession();
      const before = (await service.getSession(token))!.identity.avatar;
      const after = (await service.changeDisplayName(token, "Quiet Harbor")).identity.avatar;
      expect(after).toEqual(before);
    });

    it("rejects an unsafe name without consuming the cooldown", async () => {
      const token = await newSession();
      await expect(service.changeDisplayName(token, "instagram_me")).rejects.toBeInstanceOf(
        BadRequestException
      );
      // Still allowed to try again after a rejected (unsaved) attempt.
      const status = (await service.getSession(token))!.displayNameChange;
      expect(status.allowed).toBe(true);
    });

    it("enforces once-per-day: a second change within the window is rejected", async () => {
      const token = await newSession();
      await service.changeDisplayName(token, "Mighty Beacon");
      await expect(service.changeDisplayName(token, "Sunny Meadow")).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it("allows another change once the cooldown window has elapsed", async () => {
      const token = await newSession();
      const sessionId = service.verify(token)!;
      await service.changeDisplayName(token, "Frosty Pebble");

      // Simulate the last change happening just over a day ago.
      const record = (await store.get(sessionId))!;
      const longAgo = new Date(Date.now() - (productConfig.displayNameChangeCooldownHours + 1) * 3600_000);
      record.displayNameUpdatedAt = longAgo.toISOString();
      await store.save(record);

      const summary = await service.changeDisplayName(token, "Stellar Canyon");
      expect(summary.identity.displayName).toBe("Stellar Canyon");
    });

    it("requires an accepted session", async () => {
      await expect(service.changeDisplayName(undefined, "Brave Otter")).rejects.toThrow();
    });
  });

  describe("avatar change (stories 19-21)", () => {
    async function newSession() {
      const { token } = await service.accept({
        ageConfirmed: true,
        legalVersion: productConfig.legalVersion
      });
      return token;
    }

    it("swaps the avatar from the built-in set and starts the cooldown", async () => {
      const token = await newSession();

      const summary = await service.changeAvatar(token, "fox", "#EC4899");
      expect(summary.identity.avatar).toEqual({ avatarId: "fox", backgroundColor: "#EC4899" });
      expect(summary.avatarChange.allowed).toBe(false);
      expect(summary.avatarChange.nextAllowedAt).toEqual(expect.any(String));

      // Persisted for the session.
      const resolved = await service.getSession(token);
      expect(resolved!.identity.avatar).toEqual({ avatarId: "fox", backgroundColor: "#EC4899" });
    });

    it("leaves the display name untouched when changing the avatar", async () => {
      const token = await newSession();
      const before = (await service.getSession(token))!.identity.displayName;
      const after = (await service.changeAvatar(token, "owl", "#10B981")).identity.displayName;
      expect(after).toBe(before);
    });

    it("rejects an avatar id outside the built-in set without consuming the cooldown", async () => {
      const token = await newSession();
      await expect(service.changeAvatar(token, "dragon", "#10B981")).rejects.toBeInstanceOf(
        BadRequestException
      );
      const status = (await service.getSession(token))!.avatarChange;
      expect(status.allowed).toBe(true);
    });

    it("rejects a background outside the palette", async () => {
      const token = await newSession();
      await expect(service.changeAvatar(token, "fox", "#000000")).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("enforces once-per-day independently of the name cooldown", async () => {
      const token = await newSession();
      await service.changeAvatar(token, "panda", "#3B82F6");
      await expect(service.changeAvatar(token, "cat", "#8B5CF6")).rejects.toBeInstanceOf(
        ConflictException
      );

      // A rename is still allowed — the two cooldowns are tracked separately.
      const renamed = await service.changeDisplayName(token, "Quiet Harbor");
      expect(renamed.identity.displayName).toBe("Quiet Harbor");
    });

    it("allows another change once the cooldown window has elapsed", async () => {
      const token = await newSession();
      const sessionId = service.verify(token)!;
      await service.changeAvatar(token, "koala", "#F59E0B");

      const record = (await store.get(sessionId))!;
      record.avatarUpdatedAt = new Date(
        Date.now() - (productConfig.avatarChangeCooldownHours + 1) * 3600_000
      ).toISOString();
      await store.save(record);

      const summary = await service.changeAvatar(token, "penguin", "#06B6D4");
      expect(summary.identity.avatar).toEqual({ avatarId: "penguin", backgroundColor: "#06B6D4" });
    });

    it("requires an accepted session", async () => {
      await expect(service.changeAvatar(undefined, "fox", "#EC4899")).rejects.toThrow();
    });
  });

  describe("safety guidelines gate", () => {
    async function newSession() {
      const { token } = await service.accept({
        ageConfirmed: true,
        legalVersion: productConfig.legalVersion
      });
      return token;
    }

    it("requires acceptance on first visit, then clears it", async () => {
      const token = await newSession();

      const before = await service.getSafetyStatus(token);
      expect(before).toMatchObject({ required: true, reason: "first_time", acceptedVersion: null });

      const summary = await service.acceptSafety(token, productConfig.safetyGuidelinesVersion);
      expect(summary.safety).toMatchObject({ required: false, reason: null });
      expect(await service.getSafetyStatus(token)).toMatchObject({ required: false, reason: null });
    });

    it("re-prompts when the accepted version no longer matches the current one (story 10)", async () => {
      const token = await newSession();
      const sessionId = service.verify(token)!;

      // Simulate a previously-accepted, now-outdated guidelines version persisted
      // on the record, mirroring what a version bump in config produces.
      const record = (await store.get(sessionId))!;
      record.safetyGuidelinesVersion = "2000-ancient";
      record.safetyGuidelinesAcceptedAt = new Date().toISOString();
      await store.save(record);

      expect(await service.getSafetyStatus(token)).toEqual({
        required: true,
        currentVersion: productConfig.safetyGuidelinesVersion,
        acceptedVersion: "2000-ancient",
        reason: "version_changed"
      });
    });

    it("re-prompts after an enforcement flag, then clears on re-acceptance (story 11)", async () => {
      const token = await newSession();
      await service.acceptSafety(token, productConfig.safetyGuidelinesVersion);

      await service.flagSafetyReprompt(token);
      expect(await service.getSafetyStatus(token)).toMatchObject({
        required: true,
        reason: "enforcement"
      });

      await service.acceptSafety(token, productConfig.safetyGuidelinesVersion);
      expect(await service.getSafetyStatus(token)).toMatchObject({ required: false, reason: null });
    });

    it("rejects acceptance of a stale guidelines version", async () => {
      const token = await newSession();
      await expect(service.acceptSafety(token, "1999-old")).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
