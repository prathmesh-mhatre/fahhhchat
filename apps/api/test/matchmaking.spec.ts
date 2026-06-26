import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { productConfig } from "@fahhhchat/config";
import { encodeMockGoogleToken } from "../src/auth/google-token-verifier";
import { MATCHMAKING_EVENTS } from "../src/matchmaking/matchmaking.types";
import { AppModule } from "../src/modules/app.module";

/**
 * End-to-end matchmaking over a real Socket.IO server. This exercises the part
 * that unit tests can't: that the matchmaking gateway reads the identity the
 * realtime gateway stashed on the *same* shared connection, and that a match
 * notification is cross-delivered from one socket to the other.
 */
describe("Matchmaking shared queue (e2e)", () => {
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

  async function guestToken(): Promise<string> {
    const accept = await request(app.getHttpServer())
      .post("/session/guest/accept")
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post("/realtime/token")
      .set("Cookie", accept.headers["set-cookie"])
      .expect(200);
    return res.body.token as string;
  }

  async function userToken(sub: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post("/auth/google")
      .send({ idToken: encodeMockGoogleToken({ sub, email: `${sub}@e.com` }) })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post("/realtime/token")
      .set("Cookie", login.headers["set-cookie"])
      .expect(200);
    return res.body.token as string;
  }

  /** Connect, wait for `authenticated`, then resolve the live socket. */
  function connect(token: string): Promise<Socket> {
    const socket = io(url, {
      transports: ["websocket"],
      reconnection: false,
      auth: { token },
    });
    return new Promise((resolve) => {
      socket.on("authenticated", () => resolve(socket));
    });
  }

  function once<T = unknown>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
  }

  it("pairs a guest and a logged-in user from the one shared pool", async () => {
    const [guest, user] = await Promise.all([
      connect(await guestToken()),
      connect(await userToken("mm-user-1")),
    ]);

    const guestMatch = once<{ matchId: string; role: string }>(
      guest,
      MATCHMAKING_EVENTS.matchFound
    );
    const userMatch = once<{ matchId: string; role: string }>(
      user,
      MATCHMAKING_EVENTS.matchFound
    );

    // Guest joins first and waits; the user joining triggers the pair.
    guest.emit(MATCHMAKING_EVENTS.join);
    await once(guest, MATCHMAKING_EVENTS.waiting);
    user.emit(MATCHMAKING_EVENTS.join);

    const [g, u] = await Promise.all([guestMatch, userMatch]);
    expect(g.matchId).toBe(u.matchId);
    expect(u.role).toBe("initiator");
    expect(g.role).toBe("responder");

    guest.close();
    user.close();
  });

  it("exposes internal queue-health metrics without a public online count", async () => {
    const res = await request(app.getHttpServer())
      .get("/matchmaking/metrics")
      .expect(200);

    // The ops shape is present (story 38); `waiting` is an internal field, not a
    // user-facing online count (story 37).
    expect(res.body).toMatchObject({
      waiting: expect.any(Number),
      totalJoins: expect.any(Number),
      totalMatches: expect.any(Number),
    });
  });
});
