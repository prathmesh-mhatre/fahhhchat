import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { defaultFeatureFlags, productConfig } from "@fahhhchat/config";
import { FeatureFlagsModule } from "../src/feature-flags/feature-flags.module";
import { SessionModule } from "../src/session/session.module";

/**
 * Boot a fresh app with the given disabled kill switches seeded from the env, so
 * each scenario exercises the real module wiring (controller + guard + service).
 */
async function bootApp(disabled: string): Promise<INestApplication> {
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.REDIS_URL;
  if (disabled) {
    process.env.FEATURE_FLAGS_DISABLED = disabled;
  } else {
    delete process.env.FEATURE_FLAGS_DISABLED;
  }

  const moduleRef = await Test.createTestingModule({
    imports: [FeatureFlagsModule, SessionModule]
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return app;
}

describe("Feature flags (e2e)", () => {
  describe("with every surface enabled", () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp("");
    });

    afterAll(async () => {
      await app.close();
    });

    it("exposes the full kill-switch state publicly (no auth)", async () => {
      const res = await request(app.getHttpServer()).get("/feature-flags").expect(200);
      expect(res.body).toEqual(defaultFeatureFlags);
    });

    it("allows guest acceptance while guest_access is on", async () => {
      await request(app.getHttpServer())
        .post("/session/guest/accept")
        .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
        .expect(200);
    });
  });

  describe("with guest_access and queue_entry killed", () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp("guest_access,queue_entry");
    });

    afterAll(async () => {
      await app.close();
    });

    it("reports the killed surfaces as disabled", async () => {
      const res = await request(app.getHttpServer()).get("/feature-flags").expect(200);
      expect(res.body).toMatchObject({
        guest_access: false,
        queue_entry: false,
        camera_media: true,
        gender_filters: true
      });
    });

    it("returns 503 from guest acceptance when guest_access is off", async () => {
      await request(app.getHttpServer())
        .post("/session/guest/accept")
        .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
        .expect(503);
    });
  });
});
