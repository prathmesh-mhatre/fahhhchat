import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { productConfig } from "@fahhhchat/config";
import {
  CHAT_EVENTS,
  type AckPayload,
  type ChatMessagePayload,
  type TypingIndicatorPayload,
} from "../src/chat/chat.types";
import { MATCHMAKING_EVENTS } from "../src/matchmaking/matchmaking.types";
import { AppModule } from "../src/modules/app.module";

/**
 * End-to-end realtime text chat over a real Socket.IO server (issue #21). This
 * exercises what the unit tests can't: that a message sent on one authenticated
 * connection is delivered to the *paired* connection and acknowledged back to the
 * sender across the wire, that history is gone the moment the match ends, and
 * that a send after the match ends is refused so nothing is delivered out of
 * context (stories 39, 43, 46).
 */
describe("Realtime text chat (e2e)", () => {
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

  /** Mint a fresh realtime handshake token for an existing guest session cookie. */
  async function tokenFor(cookie: string[]): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/realtime/token")
      .set("Cookie", cookie)
      .expect(200);
    return res.body.token as string;
  }

  /**
   * Accept a fresh guest session and mint its realtime token, returning the token,
   * the server-generated display name (so a typing test can assert the exact name
   * the stranger sees, story 40), and the session cookie (so a reconnect test can
   * mint a *new* token for the *same* session, story 47).
   */
  async function guest(): Promise<{
    token: string;
    displayName: string;
    cookie: string[];
  }> {
    const accept = await request(app.getHttpServer())
      .post("/session/guest/accept")
      .send({ ageConfirmed: true, legalVersion: productConfig.legalVersion })
      .expect(200);
    const cookie = accept.headers["set-cookie"] as unknown as string[];
    return {
      token: await tokenFor(cookie),
      displayName: accept.body.identity.displayName as string,
      cookie,
    };
  }

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

  /** Connect two guests and queue them until they are paired into one match. */
  async function pair(): Promise<{
    a: Socket;
    b: Socket;
    aName: string;
    bName: string;
    ga: Awaited<ReturnType<typeof guest>>;
    gb: Awaited<ReturnType<typeof guest>>;
  }> {
    const [ga, gb] = await Promise.all([guest(), guest()]);
    const [a, b] = await Promise.all([connect(ga.token), connect(gb.token)]);
    const aMatched = once(a, MATCHMAKING_EVENTS.matchFound);
    const bMatched = once(b, MATCHMAKING_EVENTS.matchFound);
    a.emit(MATCHMAKING_EVENTS.join);
    await once(a, MATCHMAKING_EVENTS.waiting);
    b.emit(MATCHMAKING_EVENTS.join);
    await Promise.all([aMatched, bMatched]);
    return { a, b, aName: ga.displayName, bName: gb.displayName, ga, gb };
  }

  it("delivers a message to the partner and acknowledges the sender (story 39)", async () => {
    const { a, b } = await pair();

    const received = once<ChatMessagePayload>(b, CHAT_EVENTS.message);
    const acked = once<AckPayload>(a, CHAT_EVENTS.ack);
    a.emit(CHAT_EVENTS.send, {
      text: "hello stranger",
      clientMessageId: "c-1",
    });

    const [message, ack] = await Promise.all([received, acked]);
    expect(message.text).toBe("hello stranger");
    // The sender's ack carries the same server id the partner received, plus the
    // sender's own correlation id so it can clear the pending bubble.
    expect(ack.clientMessageId).toBe("c-1");
    expect(ack.messageId).toBe(message.messageId);

    a.close();
    b.close();
  });

  it("relays a typing indicator to the partner with the typist's generated name (story 40)", async () => {
    const { a, b, aName } = await pair();

    // a starts typing → b is told, with a's server-generated display name.
    const typing = once<TypingIndicatorPayload>(b, CHAT_EVENTS.typing);
    a.emit(CHAT_EVENTS.typing, { isTyping: true });
    const start = await typing;
    expect(start.displayName).toBe(aName);
    expect(start.isTyping).toBe(true);

    // a stops typing → the same channel carries the stop toggle.
    const stopped = once<TypingIndicatorPayload>(b, CHAT_EVENTS.typing);
    a.emit(CHAT_EVENTS.typing, { isTyping: false });
    const stop = await stopped;
    expect(stop.displayName).toBe(aName);
    expect(stop.isTyping).toBe(false);

    a.close();
    b.close();
  });

  it("warns the partner and holds the chat open when a socket briefly drops (story 47)", async () => {
    const { a, b } = await pair();

    // a's connection drops: b is told the partner is reconnecting, NOT that the
    // chat ended, and the match is held open for the grace window.
    const dropped = once<{ matchId: string; graceSeconds: number }>(
      b,
      CHAT_EVENTS.partnerDisconnected,
    );
    a.close();
    const notice = await dropped;
    expect(notice.graceSeconds).toBe(productConfig.reconnectGraceSeconds);

    // The match is still live: b's send is accepted (and buffered for a's return),
    // not refused as match-ended.
    const acked = once<AckPayload>(b, CHAT_EVENTS.ack);
    b.emit(CHAT_EVENTS.send, { text: "you still there?", clientMessageId: "c-2" });
    const ack = await acked;
    expect(ack.clientMessageId).toBe("c-2");

    b.close();
  });

  it("restores the chat, and replays missed messages, when the same session reconnects in time (story 47)", async () => {
    const { a, b, ga } = await pair();

    // a drops; b keeps talking while a is away — the message buffers.
    const dropped = once(b, CHAT_EVENTS.partnerDisconnected);
    a.close();
    await dropped;
    const acked = once<AckPayload>(b, CHAT_EVENTS.ack);
    b.emit(CHAT_EVENTS.send, { text: "wb soon?", clientMessageId: "c-3" });
    await acked;

    // a reconnects as the *same* guest session (new token, same cookie) and asks
    // to resume; the server restores the match and replays the buffer.
    const a2 = await connect(await tokenFor(ga.cookie));
    const partnerBack = once(b, CHAT_EVENTS.partnerReconnected);
    const resumed = once<{
      role: string;
      partnerConnected: boolean;
      buffer: ChatMessagePayload[];
    }>(a2, CHAT_EVENTS.resumed);
    a2.emit(CHAT_EVENTS.resume);
    const [restored] = await Promise.all([resumed, partnerBack]);
    expect(restored.partnerConnected).toBe(true);
    expect(restored.buffer.map((m) => m.text)).toEqual(["wb soon?"]);

    // The chat works again end-to-end: a's new socket reaches b.
    const received = once<ChatMessagePayload>(b, CHAT_EVENTS.message);
    a2.emit(CHAT_EVENTS.send, { text: "back!" });
    expect((await received).text).toBe("back!");

    a2.close();
    b.close();
  });
});
