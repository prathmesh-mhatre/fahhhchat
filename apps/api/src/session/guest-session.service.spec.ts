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
      acceptedAt: expect.any(String)
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
});
