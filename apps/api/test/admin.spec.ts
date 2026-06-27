import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminModule } from "../src/admin/admin.module";
import { encodeMockGoogleToken } from "../src/auth/google-token-verifier";

/**
 * End-to-end proof of the admin-auth slice (issue #34, stories 82-83): boot the
 * real module wiring (controller + guard + service + allowlist seed) and exercise
 * the protected `/admin/me` endpoint over HTTP. Admin access requires a Google
 * login *plus* a seeded role, so an allowlisted admin gets 200 while a normal
 * authenticated Google user and an anonymous caller get 403.
 */
describe("Admin auth (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_DEV_MODE = "true";
    delete process.env.GOOGLE_CLIENT_ID;
    // Seed a single initial admin via the config-driven allowlist (story 83).
    process.env.ADMIN_EMAIL_ALLOWLIST = "founder@example.com";

    const moduleRef = await Test.createTestingModule({ imports: [AdminModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // init() fires OnModuleInit, which seeds the allowlist.
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Log a Google identity in and return its fc_user session cookie. */
  async function loginCookie(sub: string, email: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post("/auth/google")
      .send({ idToken: encodeMockGoogleToken({ sub, email }) })
      .expect(200);
    return res.headers["set-cookie"];
  }

  it("returns 200 and the role for an allowlisted admin", async () => {
    const cookie = await loginCookie("google-founder", "founder@example.com");

    const res = await request(app.getHttpServer()).get("/admin/me").set("Cookie", cookie).expect(200);
    expect(res.body).toEqual({ isAdmin: true, role: "admin" });
    // The admin's Google email must never travel back to the client.
    expect(JSON.stringify(res.body)).not.toContain("founder@example.com");
  });

  it("returns 403 for a normal authenticated Google user", async () => {
    const cookie = await loginCookie("google-stranger", "stranger@example.com");

    await request(app.getHttpServer()).get("/admin/me").set("Cookie", cookie).expect(403);
  });

  it("returns 403 for an anonymous request", async () => {
    await request(app.getHttpServer()).get("/admin/me").expect(403);
  });
});
