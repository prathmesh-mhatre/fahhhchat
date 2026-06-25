import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { productConfig } from "@fahhhchat/config";
import { SessionModule } from "../src/session/session.module";

describe("Session gate (e2e)", () => {
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

  function acceptCookie() {
    return request(app.getHttpServer())
      .post("/session/guest/accept")
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion });
  }

  it("rejects acceptance without 18+ confirmation", async () => {
    await request(app.getHttpServer())
      .post("/session/guest/accept")
      .send({ ageConfirmed: false, legalVersion: productConfig.legalVersion })
      .expect(400);
  });

  it("accepts a valid submission and sets an http-only guest cookie", async () => {
    const res = await acceptCookie().expect(200);

    expect(res.body).toMatchObject({ accepted: true, legalVersion: productConfig.legalVersion });
    const setCookie = res.headers["set-cookie"][0];
    expect(setCookie).toContain("fc_guest=");
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("returns 401 from /session/me without an accepted session", async () => {
    await request(app.getHttpServer()).get("/session/me").expect(401);
  });

  it("returns the acceptance from /session/me once accepted", async () => {
    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    const res = await request(app.getHttpServer()).get("/session/me").set("Cookie", cookie).expect(200);
    expect(res.body).toMatchObject({ accepted: true, legalVersion: productConfig.legalVersion });
  });

  it("guards queue eligibility until the gate is accepted", async () => {
    await request(app.getHttpServer()).get("/session/queue-eligibility").expect(401);

    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    const res = await request(app.getHttpServer())
      .get("/session/queue-eligibility")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ eligible: true, legalVersion: productConfig.legalVersion });
  });
});
