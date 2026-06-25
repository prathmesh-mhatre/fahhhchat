import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { productConfig } from "@fahhhchat/config";
import { SessionModule } from "../src/session/session.module";

describe("Safety guidelines gate (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.REDIS_URL;

    const moduleRef = await Test.createTestingModule({
      imports: [SessionModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Pass the legal gate and return the issued cookie. */
  async function legalCookie(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post("/session/guest/accept")
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
      .expect(200);
    return res.headers["set-cookie"];
  }

  it("requires a legal session before accepting safety guidelines", async () => {
    await request(app.getHttpServer())
      .post("/session/safety/accept")
      .send({ safetyVersion: productConfig.safetyGuidelinesVersion })
      .expect(401);
  });

  it("flags the safety gate as required (first_time) right after legal acceptance", async () => {
    const cookie = await legalCookie();
    const res = await request(app.getHttpServer()).get("/session/me").set("Cookie", cookie).expect(200);

    expect(res.body.safety).toEqual({
      required: true,
      currentVersion: productConfig.safetyGuidelinesVersion,
      acceptedVersion: null,
      reason: "first_time"
    });
  });

  it("rejects safety acceptance for a stale guidelines version", async () => {
    const cookie = await legalCookie();
    await request(app.getHttpServer())
      .post("/session/safety/accept")
      .set("Cookie", cookie)
      .send({ safetyVersion: "1999-old" })
      .expect(400);
  });

  it("clears the safety gate once the current guidelines are accepted", async () => {
    const cookie = await legalCookie();

    const accepted = await request(app.getHttpServer())
      .post("/session/safety/accept")
      .set("Cookie", cookie)
      .send({ safetyVersion: productConfig.safetyGuidelinesVersion })
      .expect(200);
    expect(accepted.body.safety).toMatchObject({ required: false, reason: null });

    const me = await request(app.getHttpServer()).get("/session/me").set("Cookie", cookie).expect(200);
    expect(me.body.safety).toEqual({
      required: false,
      currentVersion: productConfig.safetyGuidelinesVersion,
      acceptedVersion: productConfig.safetyGuidelinesVersion,
      reason: null
    });
  });

  it("re-prompts after an enforcement event (story 11)", async () => {
    const cookie = await legalCookie();

    await request(app.getHttpServer())
      .post("/session/safety/accept")
      .set("Cookie", cookie)
      .send({ safetyVersion: productConfig.safetyGuidelinesVersion })
      .expect(200);

    await request(app.getHttpServer()).post("/session/safety/reprompt").set("Cookie", cookie).expect(200);

    const me = await request(app.getHttpServer()).get("/session/me").set("Cookie", cookie).expect(200);
    expect(me.body.safety).toMatchObject({ required: true, reason: "enforcement" });

    // Accepting again clears the re-prompt.
    await request(app.getHttpServer())
      .post("/session/safety/accept")
      .set("Cookie", cookie)
      .send({ safetyVersion: productConfig.safetyGuidelinesVersion })
      .expect(200);
    const cleared = await request(app.getHttpServer()).get("/session/me").set("Cookie", cookie).expect(200);
    expect(cleared.body.safety).toMatchObject({ required: false, reason: null });
  });
});
