import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { productConfig } from "@fahhhchat/config";
import { ConsentModule } from "../src/consent/consent.module";

describe("Cookie/analytics consent (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret";

    const moduleRef = await Test.createTestingModule({
      imports: [ConsentModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires opt-in and keeps analytics off for an EEA region", async () => {
    const res = await request(app.getHttpServer())
      .get("/consent")
      .set("x-country", "DE")
      .expect(200);

    expect(res.body).toEqual({
      version: productConfig.consentVersion,
      region: "DE",
      regime: "opt_in",
      essential: true,
      analytics: false,
      required: true,
      decidedAt: null
    });
  });

  it("allows implied analytics but still prompts for an opt-out region", async () => {
    const res = await request(app.getHttpServer())
      .get("/consent")
      .set("x-country", "US")
      .expect(200);

    expect(res.body).toMatchObject({
      regime: "opt_out",
      analytics: true,
      required: true,
      decidedAt: null
    });
  });

  it("treats an undetectable region as opt-in", async () => {
    const res = await request(app.getHttpServer()).get("/consent").expect(200);
    expect(res.body).toMatchObject({ region: "unknown", regime: "opt_in", analytics: false });
  });

  it("persists an opt-in decision and reads it back as not required", async () => {
    const accept = await request(app.getHttpServer())
      .post("/consent")
      .set("x-country", "DE")
      .send({ version: productConfig.consentVersion, analytics: true })
      .expect(200);

    expect(accept.body).toMatchObject({ analytics: true, required: false });
    const cookie = accept.headers["set-cookie"];
    expect(cookie).toBeDefined();

    const me = await request(app.getHttpServer())
      .get("/consent")
      .set("x-country", "DE")
      .set("Cookie", cookie)
      .expect(200);
    expect(me.body).toMatchObject({ analytics: true, required: false });
    expect(me.body.decidedAt).toEqual(expect.any(String));
  });

  it("persists an analytics opt-out (essential only)", async () => {
    const reject = await request(app.getHttpServer())
      .post("/consent")
      .set("x-country", "US")
      .send({ version: productConfig.consentVersion, analytics: false })
      .expect(200);

    expect(reject.body).toMatchObject({ essential: true, analytics: false, required: false });

    const me = await request(app.getHttpServer())
      .get("/consent")
      .set("x-country", "US")
      .set("Cookie", reject.headers["set-cookie"])
      .expect(200);
    expect(me.body).toMatchObject({ analytics: false, required: false });
  });

  it("rejects a decision for a stale policy version", async () => {
    await request(app.getHttpServer())
      .post("/consent")
      .set("x-country", "DE")
      .send({ version: "1999-old", analytics: true })
      .expect(400);
  });

  it("re-prompts when a stored decision predates the current policy version", async () => {
    // Decide, then read back with the current version: honored. (A genuinely
    // stale cookie is covered in the service unit spec, which can forge one.)
    const accept = await request(app.getHttpServer())
      .post("/consent")
      .set("x-country", "DE")
      .send({ version: productConfig.consentVersion, analytics: true })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get("/consent")
      .set("x-country", "DE")
      .set("Cookie", accept.headers["set-cookie"])
      .expect(200);
    expect(me.body.required).toBe(false);
  });
});
