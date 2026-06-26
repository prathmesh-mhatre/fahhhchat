import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { productConfig } from "@fahhhchat/config";
import { encodeMockGoogleToken } from "../src/auth/google-token-verifier";
import { AppModule } from "../src/modules/app.module";

/**
 * Resolve once the socket reports authentication (`authenticated` event) or
 * rejection (`auth_error` / disconnect), so each test asserts the gateway's
 * decision deterministically.
 */
function awaitAuthOutcome(
  socket: Socket,
): Promise<{ ok: boolean; identity?: unknown }> {
  return new Promise((resolve) => {
    socket.on("authenticated", (payload: { identity: unknown }) =>
      resolve({ ok: true, identity: payload.identity }),
    );
    socket.on("auth_error", () => resolve({ ok: false }));
    socket.on("connect_error", () => resolve({ ok: false }));
    socket.on("disconnect", () => resolve({ ok: false }));
  });
}

describe("Realtime auth (e2e)", () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_DEV_MODE = "true";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.REDIS_URL;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    await app.listen(0);

    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function guestCookie(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post("/session/guest/accept")
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
      .expect(200);
    return res.headers["set-cookie"];
  }

  async function userCookie(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post("/auth/google")
      .send({
        idToken: encodeMockGoogleToken({
          sub: "google-rt",
          email: "rt@example.com",
        }),
      })
      .expect(200);
    return res.headers["set-cookie"];
  }

  function connect(
    token?: string,
  ): Promise<{ socket: Socket; outcome: { ok: boolean; identity?: unknown } }> {
    const socket = io(url, {
      transports: ["websocket"],
      reconnection: false,
      auth: token ? { token } : {},
    });
    return awaitAuthOutcome(socket).then((outcome) => ({ socket, outcome }));
  }

  it("rejects a token request with no identity (401)", async () => {
    await request(app.getHttpServer()).post("/realtime/token").expect(401);
  });

  it("issues a guest handshake token and authenticates the socket", async () => {
    const cookie = await guestCookie();
    const res = await request(app.getHttpServer())
      .post("/realtime/token")
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.identity).toMatchObject({
      kind: "guest",
      id: expect.any(String),
    });
    expect(res.body.token).toEqual(expect.any(String));

    const { socket, outcome } = await connect(res.body.token);
    expect(outcome).toEqual({
      ok: true,
      identity: { kind: "guest", id: res.body.identity.id },
    });
    socket.close();
  });

  it("issues a user handshake token and prefers the account over a guest cookie", async () => {
    const cookie = [...(await guestCookie()), ...(await userCookie())];
    const res = await request(app.getHttpServer())
      .post("/realtime/token")
      .set("Cookie", cookie)
      .expect(200);

    // A signed-in caller resolves to their durable account, not the guest session.
    expect(res.body.identity.kind).toBe("user");

    const { socket, outcome } = await connect(res.body.token);
    expect(outcome).toEqual({
      ok: true,
      identity: { kind: "user", id: res.body.identity.id },
    });
    socket.close();
  });

  it("disconnects a socket that presents no token", async () => {
    const { socket, outcome } = await connect();
    expect(outcome.ok).toBe(false);
    socket.close();
  });

  it("disconnects a socket that presents a tampered token", async () => {
    const cookie = await guestCookie();
    const res = await request(app.getHttpServer())
      .post("/realtime/token")
      .set("Cookie", cookie)
      .expect(200);

    const { socket, outcome } = await connect(`${res.body.token}tampered`);
    expect(outcome.ok).toBe(false);
    socket.close();
  });
});
