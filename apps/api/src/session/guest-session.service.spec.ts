import { BadRequestException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { GuestSessionService } from "./guest-session.service";
import { InMemorySessionStore } from "./in-memory-session.store";

describe("GuestSessionService", () => {
  let store: InMemorySessionStore;
  let service: GuestSessionService;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  beforeEach(() => {
    store = new InMemorySessionStore();
    service = new GuestSessionService(store);
  });

  it("rejects acceptance when 18+ is not confirmed", async () => {
    await expect(
      service.accept({ ageConfirmed: false, legalVersion: productConfig.legalVersion })
    ).rejects.toBeInstanceOf(BadRequestException);
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
    const orphan = new GuestSessionService(new InMemorySessionStore());
    const { token } = await orphan.accept({
      ageConfirmed: true,
      legalVersion: productConfig.legalVersion
    });

    expect(await service.getSession(token)).toBeNull();
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
