import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { productConfig } from "@fahhhchat/config";
import { AuthModule } from "../src/auth/auth.module";
import { encodeMockGoogleToken } from "../src/auth/google-token-verifier";

describe("Auth (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_DEV_MODE = "true";
    delete process.env.GOOGLE_CLIENT_ID;

    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const idToken = encodeMockGoogleToken({ sub: "google-e2e", email: "e2e@example.com" });

  function login() {
    return request(app.getHttpServer()).post("/auth/google").send({ idToken });
  }

  it("rejects login with an invalid Google token", async () => {
    await request(app.getHttpServer()).post("/auth/google").send({ idToken: "bogus" }).expect(401);
  });

  it("logs in, sets an http-only user cookie, and hides Google identity", async () => {
    const res = await login().expect(200);

    expect(res.body).toMatchObject({ loggedIn: true, userId: expect.any(String) });
    // A generated identity is returned in place of the Google identity (story 14).
    expect(res.body.identity).toMatchObject({
      displayName: expect.any(String),
      avatar: { avatarId: expect.any(String), backgroundColor: expect.any(String) }
    });
    expect(JSON.stringify(res.body)).not.toContain("e2e@example.com");

    const setCookie = res.headers["set-cookie"][0];
    expect(setCookie).toContain("fc_user=");
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("returns 401 from /auth/me without a session", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("persists legal acceptance to the account across requests", async () => {
    const cookie = (await login().expect(200)).headers["set-cookie"];

    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.legal.required).toBe(true);

    await request(app.getHttpServer())
      .post("/auth/legal/accept")
      .set("Cookie", cookie)
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
      .expect(200);

    const after = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(after.body.legal.required).toBe(false);
  });

  it("changes the display name once, moderates it, and enforces the cooldown (stories 16-18)", async () => {
    const cookie = (await login().expect(200)).headers["set-cookie"];

    // Unsafe name rejected with 400.
    await request(app.getHttpServer())
      .post("/auth/username")
      .set("Cookie", cookie)
      .send({ displayName: "support" })
      .expect(400);

    // Safe name accepted and surfaced.
    const renamed = await request(app.getHttpServer())
      .post("/auth/username")
      .set("Cookie", cookie)
      .send({ displayName: "Nimble Marble" })
      .expect(200);
    expect(renamed.body.identity.displayName).toBe("Nimble Marble");

    // Persisted on /auth/me.
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.identity.displayName).toBe("Nimble Marble");

    // Second change within the day blocked (409).
    await request(app.getHttpServer())
      .post("/auth/username")
      .set("Cookie", cookie)
      .send({ displayName: "Jolly Thistle" })
      .expect(409);
  });

  it("changes the avatar from the built-in set, persists it, and enforces the cooldown (stories 19-21)", async () => {
    const cookie = (await login().expect(200)).headers["set-cookie"];

    // An avatar outside the built-in set is rejected with 400.
    await request(app.getHttpServer())
      .post("/auth/avatar")
      .set("Cookie", cookie)
      .send({ avatarId: "dragon", backgroundColor: "#10B981" })
      .expect(400);

    const changed = await request(app.getHttpServer())
      .post("/auth/avatar")
      .set("Cookie", cookie)
      .send({ avatarId: "owl", backgroundColor: "#10B981" })
      .expect(200);
    expect(changed.body.identity.avatar).toEqual({ avatarId: "owl", backgroundColor: "#10B981" });

    // Persisted on /auth/me.
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.identity.avatar).toEqual({ avatarId: "owl", backgroundColor: "#10B981" });

    // Second change within the day blocked (409).
    await request(app.getHttpServer())
      .post("/auth/avatar")
      .set("Cookie", cookie)
      .send({ avatarId: "cat", backgroundColor: "#3B82F6" })
      .expect(409);
  });

  it("saves language + gender onboarding, persists it, and validates input (stories 27-29)", async () => {
    const cookie = (await login().expect(200)).headers["set-cookie"];

    // A fresh account owes onboarding with default preferences.
    const before = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(before.body.onboarding.required).toBe(true);
    expect(before.body.preferences).toEqual({
      uiLanguage: "en",
      matchingLanguage: "en",
      gender: null,
      genderFilter: "both"
    });

    // Invalid submissions are rejected with 400.
    await request(app.getHttpServer())
      .post("/auth/preferences")
      .set("Cookie", cookie)
      .send({ matchingLanguage: "klingon", gender: "male" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/auth/preferences")
      .set("Cookie", cookie)
      .send({ matchingLanguage: "en", gender: "other" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/auth/preferences")
      .set("Cookie", cookie)
      .send({ matchingLanguage: "en", gender: "male", genderFilter: "everyone" })
      .expect(400);

    // Valid submission keeps UI and matching language separate (story 27) and
    // captures the gender filter (story 30).
    const saved = await request(app.getHttpServer())
      .post("/auth/preferences")
      .set("Cookie", cookie)
      .send({ matchingLanguage: "es", gender: "female", uiLanguage: "en", genderFilter: "male" })
      .expect(200);
    expect(saved.body.onboarding.required).toBe(false);
    expect(saved.body.preferences).toEqual({
      uiLanguage: "en",
      matchingLanguage: "es",
      gender: "female",
      genderFilter: "male"
    });

    // Persisted on /auth/me.
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.preferences).toEqual({
      uiLanguage: "en",
      matchingLanguage: "es",
      gender: "female",
      genderFilter: "male"
    });
  });

  it("rejects a preferences change without a session (guard enforced)", async () => {
    await request(app.getHttpServer())
      .post("/auth/preferences")
      .send({ matchingLanguage: "en", gender: "male" })
      .expect(401);
  });

  it("rejects an avatar change without a session (guard enforced)", async () => {
    await request(app.getHttpServer())
      .post("/auth/avatar")
      .send({ avatarId: "fox", backgroundColor: "#EC4899" })
      .expect(401);
  });

  it("rejects a username change without a session (guard enforced)", async () => {
    await request(app.getHttpServer())
      .post("/auth/username")
      .send({ displayName: "Brave Otter" })
      .expect(401);
  });

  it("rejects legal acceptance without a session (guard enforced)", async () => {
    await request(app.getHttpServer())
      .post("/auth/legal/accept")
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
      .expect(401);
  });
});
