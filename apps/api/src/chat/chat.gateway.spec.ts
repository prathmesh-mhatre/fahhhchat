import type { Server, Socket } from "socket.io";
import type {
  Match,
  QueuedParticipant,
} from "../matchmaking/matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";
import { CHAT_EVENTS, type DisplayNameResolver } from "./chat.types";
import { InMemoryChatStore } from "./in-memory-chat.store";

interface Emit {
  event: string;
  payload: unknown;
}

/** Fake socket carrying a (possibly absent) authenticated identity. */
function fakeSocket(id: string, identity?: RealtimeIdentity) {
  const emitted: Emit[] = [];
  const socket = {
    id,
    data: { identity },
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return true;
    },
  } as unknown as Socket;
  return { socket, emitted };
}

/** Fake Socket.IO server recording `server.to(socketId).emit(...)` fan-out. */
function fakeServer() {
  const delivered: Array<{ to: string } & Emit> = [];
  const server = {
    to(socketId: string) {
      return {
        emit(event: string, payload: unknown) {
          delivered.push({ to: socketId, event, payload });
          return true;
        },
      };
    },
  } as unknown as Server;
  return { server, delivered };
}

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

function participant(
  identity: RealtimeIdentity,
  socketId: string,
): QueuedParticipant {
  return {
    identity,
    socketId,
    enqueuedAt: 0,
    language: "en",
    gender: null,
    genderFilter: "both",
  };
}

/** Resolves each participant to a fixed generated name for typing assertions. */
const resolver: DisplayNameResolver = {
  async resolve(identity) {
    return identity.kind === "user" ? "Mellow Otter" : "Cosmic Sparrow";
  },
};

function buildGateway() {
  const chat = new ChatService(new InMemoryChatStore(), resolver);
  const gateway = new ChatGateway(chat);
  const { server, delivered } = fakeServer();
  (gateway as unknown as { server: Server }).server = server;
  return { gateway, chat, delivered };
}

const INITIATOR = { identity: user("u1"), socketId: "s-init" };
const RESPONDER = { identity: guest("g1"), socketId: "s-resp" };

/** Register an active match between the two fixed participants. */
async function seedMatch(chat: ChatService): Promise<Match> {
  const m: Match = {
    matchId: "m1",
    createdAt: new Date().toISOString(),
    initiator: participant(INITIATOR.identity, INITIATOR.socketId),
    responder: participant(RESPONDER.identity, RESPONDER.socketId),
  };
  await chat.registerMatch(m);
  return m;
}

describe("ChatGateway", () => {
  it("delivers a message to the partner and acknowledges the sender (story 39)", async () => {
    const { gateway, chat, delivered } = buildGateway();
    await seedMatch(chat);
    const sender = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

    await gateway.handleSend(sender.socket, {
      text: "hello",
      clientMessageId: "c-1",
    });

    // Partner receives the message...
    const message = delivered.find((d) => d.event === CHAT_EVENTS.message);
    expect(message?.to).toBe(RESPONDER.socketId);
    const body = message?.payload as {
      text: string;
      from: string;
      messageId: string;
    };
    expect(body.text).toBe("hello");
    expect(body.from).toBe("initiator");

    // ...and the sender is acknowledged with the same server message id + its
    // own correlation id so it can clear the pending bubble (stories 42).
    const ack = sender.emitted.find((e) => e.event === CHAT_EVENTS.ack);
    const ackBody = ack?.payload as {
      messageId: string;
      clientMessageId: string;
    };
    expect(ackBody.clientMessageId).toBe("c-1");
    expect(ackBody.messageId).toBe(body.messageId);
  });

  it("never echoes the message back to the sender's own socket", async () => {
    const { gateway, chat, delivered } = buildGateway();
    await seedMatch(chat);
    const sender = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

    await gateway.handleSend(sender.socket, { text: "hello" });

    const echoed = delivered.filter(
      (d) => d.event === CHAT_EVENTS.message && d.to === INITIATOR.socketId,
    );
    expect(echoed).toHaveLength(0);
  });

  it("tells the sender to stop retrying once the match has ended (story 43)", async () => {
    const { gateway, chat } = buildGateway();
    const m = await seedMatch(chat);
    await chat.endMatch(m.matchId, "partner_disconnected");
    const sender = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

    await gateway.handleSend(sender.socket, {
      text: "too late",
      clientMessageId: "c-9",
    });

    expect(sender.emitted).toContainEqual({
      event: CHAT_EVENTS.sendFailed,
      payload: { clientMessageId: "c-9", reason: "match_ended" },
    });
  });

  it("reports a validation failure to the sender", async () => {
    const { gateway, chat } = buildGateway();
    await seedMatch(chat);
    const sender = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

    await gateway.handleSend(sender.socket, {
      text: "   ",
      clientMessageId: "c-2",
    });

    expect(sender.emitted).toContainEqual({
      event: CHAT_EVENTS.sendFailed,
      payload: { clientMessageId: "c-2", reason: "empty" },
    });
  });

  it("refuses a send from an unauthenticated socket", async () => {
    const { gateway } = buildGateway();
    const sender = fakeSocket("rogue"); // no identity

    await gateway.handleSend(sender.socket, { text: "hello" });

    expect(sender.emitted.map((e) => e.event)).toContain(
      CHAT_EVENTS.sendFailed,
    );
  });

  it("ends the match on disconnect and tells the partner the chat is over", async () => {
    const { gateway, chat, delivered } = buildGateway();
    await seedMatch(chat);
    const initiatorSocket = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

    await gateway.handleDisconnect(initiatorSocket.socket);

    // The remaining partner is told the match ended...
    const ended = delivered.find((d) => d.event === CHAT_EVENTS.matchEnded);
    expect(ended?.to).toBe(RESPONDER.socketId);
    expect((ended?.payload as { reason: string }).reason).toBe(
      "partner_disconnected",
    );
    // ...and the match is gone, so a later send from the partner is refused.
    expect(await chat.activeMatchFor(RESPONDER.identity)).toBeNull();
  });

  it("ignores a disconnect from a socket that was never in a match", async () => {
    const { gateway, delivered } = buildGateway();
    const stranger = fakeSocket("never-chatted", guest("g99"));

    await gateway.handleDisconnect(stranger.socket);

    expect(delivered).toHaveLength(0);
  });

  describe("typing indicators (story 40)", () => {
    it("relays a typing toggle to the partner with the typist's generated name", async () => {
      const { gateway, chat, delivered } = buildGateway();
      await seedMatch(chat);
      const typist = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleTyping(typist.socket, { isTyping: true });

      const typing = delivered.find((d) => d.event === CHAT_EVENTS.typing);
      expect(typing?.to).toBe(RESPONDER.socketId);
      expect(typing?.payload).toEqual({
        matchId: "m1",
        from: "initiator",
        displayName: "Mellow Otter",
        isTyping: true,
      });
    });

    it("never echoes the typing indicator back to the typist", async () => {
      const { gateway, chat, delivered } = buildGateway();
      await seedMatch(chat);
      const typist = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleTyping(typist.socket, { isTyping: true });

      const echoed = delivered.filter(
        (d) => d.event === CHAT_EVENTS.typing && d.to === INITIATOR.socketId,
      );
      expect(echoed).toHaveLength(0);
      // The typist is told nothing in return — typing is one-way presence.
      expect(typist.emitted).toHaveLength(0);
    });

    it("ignores typing from an unauthenticated socket", async () => {
      const { gateway, delivered } = buildGateway();
      const rogue = fakeSocket("rogue"); // no identity

      await gateway.handleTyping(rogue.socket, { isTyping: true });

      expect(delivered).toHaveLength(0);
    });

    it("ignores typing when the sender is in no active match", async () => {
      const { gateway, delivered } = buildGateway();
      const lonely = fakeSocket("s-lonely", guest("g-lonely"));

      await gateway.handleTyping(lonely.socket, { isTyping: true });

      expect(delivered).toHaveLength(0);
    });
  });

  describe("no read receipts (story 41)", () => {
    it("exposes no read/seen/receipt event in the chat contract", () => {
      const names = Object.values(CHAT_EVENTS).join(" ").toLowerCase();
      expect(names).not.toMatch(/read|seen|receipt/);
    });

    it("never sends a read confirmation when a message is delivered", async () => {
      const { gateway, chat, delivered } = buildGateway();
      await seedMatch(chat);
      const sender = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleSend(sender.socket, { text: "hello" });

      // The sender's only feedback is the delivery ack — never a "read" event,
      // and the recipient is never asked to confirm a read either.
      expect(sender.emitted.map((e) => e.event)).toEqual([CHAT_EVENTS.ack]);
      expect(delivered.map((d) => d.event)).toEqual([CHAT_EVENTS.message]);
    });
  });
});
