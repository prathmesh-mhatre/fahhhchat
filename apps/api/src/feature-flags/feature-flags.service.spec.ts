import { ServiceUnavailableException } from "@nestjs/common";
import { defaultFeatureFlags } from "@fahhhchat/config";
import { FeatureFlagsService } from "./feature-flags.service";
import { InMemoryFeatureFlagStore } from "./in-memory-feature-flag.store";
import { FEATURE_FLAG_CACHE_TTL_MS } from "./feature-flags.types";

describe("FeatureFlagsService", () => {
  let store: InMemoryFeatureFlagStore;
  let service: FeatureFlagsService;

  beforeEach(() => {
    store = new InMemoryFeatureFlagStore();
    service = new FeatureFlagsService(store);
  });

  describe("default state", () => {
    it("reports every surface enabled when nothing is overridden", async () => {
      await expect(service.getState()).resolves.toEqual(defaultFeatureFlags);
      await expect(service.isEnabled("camera_media")).resolves.toBe(true);
      await expect(service.isEnabled("queue_entry")).resolves.toBe(true);
    });
  });

  describe("overrides", () => {
    it("merges a stored disable over the defaults", async () => {
      await service.setEnabled("guest_access", false, "admin-1");

      // Force a cache refresh so the new override is picked up immediately.
      jest.spyOn(Date, "now").mockReturnValue(FEATURE_FLAG_CACHE_TTL_MS + 1);
      const state = await service.getState();

      expect(state.guest_access).toBe(false);
      // Untouched surfaces stay at their default.
      expect(state.camera_media).toBe(true);
      expect(state.gender_filters).toBe(true);
      expect(state.queue_entry).toBe(true);
    });

    it("records who changed a flag and when", async () => {
      const record = await service.setEnabled("camera_media", false, "admin-7");
      expect(record).toMatchObject({ key: "camera_media", enabled: false, updatedBy: "admin-7" });
      expect(typeof record.updatedAt).toBe("string");

      const [stored] = await store.getAll();
      expect(stored).toEqual(record);
    });
  });

  describe("caching", () => {
    it("serves a cached read within the TTL without re-hitting the store", async () => {
      const spy = jest.spyOn(store, "getAll");

      await service.getState();
      await service.getState();
      await service.getState();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("re-reads the store once the cache TTL elapses", async () => {
      const spy = jest.spyOn(store, "getAll");
      const nowSpy = jest.spyOn(Date, "now");

      nowSpy.mockReturnValue(1_000);
      await service.getState();
      expect(spy).toHaveBeenCalledTimes(1);

      // Still inside the window: cached.
      nowSpy.mockReturnValue(1_000 + FEATURE_FLAG_CACHE_TTL_MS - 1);
      await service.getState();
      expect(spy).toHaveBeenCalledTimes(1);

      // Past the window: refreshed.
      nowSpy.mockReturnValue(1_000 + FEATURE_FLAG_CACHE_TTL_MS + 1);
      await service.getState();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe("assertEnabled", () => {
    it("passes through when the surface is enabled", async () => {
      await expect(service.assertEnabled("queue_entry", "nope")).resolves.toBeUndefined();
    });

    it("throws 503 with the surface's message when disabled", async () => {
      const killed = new FeatureFlagsService(new InMemoryFeatureFlagStore(["queue_entry"]));
      await expect(killed.assertEnabled("queue_entry", "Queue closed.")).rejects.toBeInstanceOf(
        ServiceUnavailableException
      );
    });
  });

  describe("boot-time seeding", () => {
    it("starts a surface disabled when seeded as a kill switch", async () => {
      const seeded = new FeatureFlagsService(
        new InMemoryFeatureFlagStore(["camera_media", "guest_access"])
      );
      const state = await seeded.getState();
      expect(state.camera_media).toBe(false);
      expect(state.guest_access).toBe(false);
      expect(state.queue_entry).toBe(true);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
