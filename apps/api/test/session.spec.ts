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
    // A generated anonymous identity is surfaced to the client (stories 13, 15).
    expect(res.body.identity).toMatchObject({
      displayName: expect.any(String),
      avatar: { avatarId: expect.any(String), backgroundColor: expect.any(String) }
    });
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

  it("changes the display name once, then enforces the daily cooldown (stories 16-18)", async () => {
    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    // A safe, moderated name is accepted and surfaced.
    const renamed = await request(app.getHttpServer())
      .post("/session/username")
      .set("Cookie", cookie)
      .send({ displayName: "Curious Lantern" })
      .expect(200);
    expect(renamed.body.identity.displayName).toBe("Curious Lantern");
    expect(renamed.body.displayNameChange.allowed).toBe(false);

    // A second change within the day is blocked by the cooldown (409).
    await request(app.getHttpServer())
      .post("/session/username")
      .set("Cookie", cookie)
      .send({ displayName: "Sunny Meadow" })
      .expect(409);
  });

  it("changes the avatar from the built-in set once, then enforces the cooldown (stories 19-21)", async () => {
    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    const changed = await request(app.getHttpServer())
      .post("/session/avatar")
      .set("Cookie", cookie)
      .send({ avatarId: "fox", backgroundColor: "#EC4899" })
      .expect(200);
    expect(changed.body.identity.avatar).toEqual({ avatarId: "fox", backgroundColor: "#EC4899" });
    expect(changed.body.avatarChange.allowed).toBe(false);

    // A second change within the day is blocked by the cooldown (409).
    await request(app.getHttpServer())
      .post("/session/avatar")
      .set("Cookie", cookie)
      .send({ avatarId: "owl", backgroundColor: "#10B981" })
      .expect(409);
  });

  it("rejects an avatar outside the built-in set (400) and requires a session (401)", async () => {
    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    await request(app.getHttpServer())
      .post("/session/avatar")
      .set("Cookie", cookie)
      .send({ avatarId: "dragon", backgroundColor: "#EC4899" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/session/avatar")
      .send({ avatarId: "fox", backgroundColor: "#EC4899" })
      .expect(401);
  });

  it("rejects an unsafe display name (400) and requires a session (401)", async () => {
    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    await request(app.getHttpServer())
      .post("/session/username")
      .set("Cookie", cookie)
      .send({ displayName: "follow my instagram" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/session/username")
      .send({ displayName: "Brave Otter" })
      .expect(401);
  });

  it("guards queue eligibility until both legal and safety gates are accepted", async () => {
    // No session at all -> 401 from the legal guard.
    await request(app.getHttpServer()).get("/session/queue-eligibility").expect(401);

    const accepted = await acceptCookie().expect(200);
    const cookie = accepted.headers["set-cookie"];

    // Legal accepted but safety guidelines not yet -> 403 from the safety guard.
    await request(app.getHttpServer())
      .get("/session/queue-eligibility")
      .set("Cookie", cookie)
      .expect(403);

    await request(app.getHttpServer())
      .post("/session/safety/accept")
      .set("Cookie", cookie)
      .send({ safetyVersion: productConfig.safetyGuidelinesVersion })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get("/session/queue-eligibility")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ eligible: true, legalVersion: productConfig.legalVersion });
  });
});
