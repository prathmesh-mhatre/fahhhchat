import type { Server, Socket } from "socket.io";
import {
  productConfig,
  rateLimits,
  reportDetailsMaxLength,
} from "@fahhhchat/config";
import type {
  Match,
  QueuedParticipant,
} from "../matchmaking/matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory-rate-limit.store";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { InMemoryRematchGuardStore } from "../rematch/in-memory-rematch-guard.store";
import { RematchGuardService } from "../rematch/rematch-guard.service";
import { InMemoryReportContextStore } from "../report-context/in-memory-report-context.store";
import { ReportContextService } from "../report-context/report-context.service";
import { InMemoryModerationCasesStore } from "../moderation-cases/in-memory-moderation-cases.store";
import { ModerationCasesService } from "../moderation-cases/moderation-cases.service";
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
  const rateLimits = new RateLimitService(new InMemoryRateLimitStore());
  const rematchGuard = new RematchGuardService(new InMemoryRematchGuardStore());
  const reportContext = new ReportContextService(
    new InMemoryReportContextStore(),
  );
  const cases = new ModerationCasesService(new InMemoryModerationCasesStore());
  const chat = new ChatService(
    new InMemoryChatStore(),
    resolver,
    rateLimits,
    rematchGuard,
    reportContext,
    cases,
  );
  const gateway = new ChatGateway(chat);
  const { server, delivered } = fakeServer();
  (gateway as unknown as { server: Server }).server = server;
  return { gateway, chat, delivered, rematchGuard, reportContext };
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

  it("tells the sender a link flood was refused as spam (story 45)", async () => {
    const { gateway, chat } = buildGateway();
    await seedMatch(chat);
    // RESPONDER is a guest; spend its link budget, then send one more link.
    const sender = fakeSocket(RESPONDER.socketId, RESPONDER.identity);

    const budget = rateLimits.chat_link.guest.limit;
    for (let i = 0; i <= budget; i += 1) {
      await gateway.handleSend(sender.socket, {
        text: `link ${i} spam.example.com`,
        clientMessageId: `c-${i}`,
      });
    }

    const lastId = `c-${budget}`;
    expect(sender.emitted).toContainEqual({
      event: CHAT_EVENTS.sendFailed,
      payload: { clientMessageId: lastId, reason: "spam" },
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

  it("ignores a disconnect from a socket that was never in a match", async () => {
    const { gateway, delivered } = buildGateway();
    const stranger = fakeSocket("never-chatted", guest("g99"));

    await gateway.handleDisconnect(stranger.socket);

    expect(delivered).toHaveLength(0);
  });

  describe("confirmed Next (issue #26, story 51)", () => {
    it("ends the match and tells only the partner the chat is over (reason `next`)", async () => {
      const { gateway, chat, delivered } = buildGateway();
      await seedMatch(chat);
      const clicker = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleNext(clicker.socket);

      const ended = delivered.filter((d) => d.event === CHAT_EVENTS.matchEnded);
      // Exactly one notice, to the partner — never echoed back to the clicker.
      expect(ended).toHaveLength(1);
      expect(ended[0].to).toBe(RESPONDER.socketId);
      expect((ended[0].payload as { reason: string }).reason).toBe("next");
      expect(clicker.emitted).toHaveLength(0);
      // The match is gone for both sides.
      expect(await chat.activeMatchFor(INITIATOR.identity)).toBeNull();
      expect(await chat.activeMatchFor(RESPONDER.identity)).toBeNull();
    });

    it("is a silent no-op for an unauthenticated socket", async () => {
      const { gateway, delivered } = buildGateway();
      const rogue = fakeSocket("rogue"); // no identity

      await gateway.handleNext(rogue.socket);

      expect(delivered).toHaveLength(0);
      expect(rogue.emitted).toHaveLength(0);
    });

    it("is a silent no-op when the socket is not in a live match", async () => {
      const { gateway, delivered } = buildGateway();
      const unmatched = fakeSocket("idle", guest("g99"));

      await gateway.handleNext(unmatched.socket);

      expect(delivered).toHaveLength(0);
    });
  });

  describe("report and block (issue #27, stories 52-56)", () => {
    it("reporting ends the match, tells only the partner (reason `report`), and blocks by default", async () => {
      const { gateway, chat, delivered, rematchGuard } = buildGateway();
      await seedMatch(chat);
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      // Omit alsoBlock entirely — the default (story 56) must still block.
      await gateway.handleReport(reporter.socket, undefined);

      const ended = delivered.filter((d) => d.event === CHAT_EVENTS.matchEnded);
      expect(ended).toHaveLength(1);
      expect(ended[0].to).toBe(RESPONDER.socketId);
      expect((ended[0].payload as { reason: string }).reason).toBe("report");
      expect(reporter.emitted).toHaveLength(0);
      expect(await chat.activeMatchFor(INITIATOR.identity)).toBeNull();
      // Default also-block recorded the rematch-prevention pair.
      expect(await rematchGuard.excludedKeysFor("user:u1")).toEqual([
        "guest:g1",
      ]);
    });

    it("honors alsoBlock:false so a report without a block records no exclusion", async () => {
      const { gateway, chat, delivered, rematchGuard } = buildGateway();
      await seedMatch(chat);
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleReport(reporter.socket, { alsoBlock: false });

      expect(
        delivered.filter((d) => d.event === CHAT_EVENTS.matchEnded),
      ).toHaveLength(1);
      expect(await rematchGuard.excludedKeysFor("user:u1")).toEqual([]);
    });

    it("blocking ends the match (reason `block`) and always records the exclusion", async () => {
      const { gateway, chat, delivered, rematchGuard } = buildGateway();
      await seedMatch(chat);
      const blocker = fakeSocket(RESPONDER.socketId, RESPONDER.identity);

      await gateway.handleBlock(blocker.socket);

      const ended = delivered.filter((d) => d.event === CHAT_EVENTS.matchEnded);
      expect(ended).toHaveLength(1);
      expect(ended[0].to).toBe(INITIATOR.socketId);
      expect((ended[0].payload as { reason: string }).reason).toBe("block");
      expect(await rematchGuard.excludedKeysFor("guest:g1")).toEqual([
        "user:u1",
      ]);
    });

    it("are silent no-ops for an unauthenticated socket", async () => {
      const { gateway, delivered } = buildGateway();
      const rogue = fakeSocket("rogue"); // no identity

      await gateway.handleReport(rogue.socket, { alsoBlock: true });
      await gateway.handleBlock(rogue.socket);

      expect(delivered).toHaveLength(0);
      expect(rogue.emitted).toHaveLength(0);
    });
  });

  describe("report form categories and details (issue #28, stories 59-61)", () => {
    it("passes the chosen category and trimmed details to the report (stories 59, 61)", async () => {
      const { gateway, chat } = buildGateway();
      await seedMatch(chat);
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);
      const reportMatch = jest.spyOn(chat, "reportMatch");

      await gateway.handleReport(reporter.socket, {
        alsoBlock: true,
        category: "harassment_hate",
        details: "  said something threatening  ",
      });

      expect(reportMatch).toHaveBeenCalledWith(INITIATOR.identity, {
        alsoBlock: true,
        category: "harassment_hate",
        details: "said something threatening",
      });
    });

    it("accepts a category-only report, dropping empty details (story 60)", async () => {
      const { gateway, chat } = buildGateway();
      await seedMatch(chat);
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);
      const reportMatch = jest.spyOn(chat, "reportMatch");

      await gateway.handleReport(reporter.socket, {
        category: "spam_scam",
        details: "   ",
      });

      const submission = reportMatch.mock.calls[0][1];
      expect(submission.category).toBe("spam_scam");
      expect(submission.details).toBeUndefined();
    });

    it("falls back to the `other` category when none (or an unknown one) is given (story 60)", async () => {
      const { gateway, chat } = buildGateway();
      await seedMatch(chat);
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);
      const reportMatch = jest.spyOn(chat, "reportMatch");

      // A minimal client sends no form, and a malformed one an unknown category;
      // both must still file a valid report rather than failing to leave the chat.
      await gateway.handleReport(reporter.socket, undefined);
      await gateway.handleReport(reporter.socket, {
        category: "not_a_real_category" as never,
      });

      expect(reportMatch.mock.calls[0][1].category).toBe("other");
      expect(reportMatch.mock.calls[1][1].category).toBe("other");
    });

    it("caps over-long details at the shared limit (story 61)", async () => {
      const { gateway, chat } = buildGateway();
      await seedMatch(chat);
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);
      const reportMatch = jest.spyOn(chat, "reportMatch");

      await gateway.handleReport(reporter.socket, {
        category: "other",
        details: "x".repeat(reportDetailsMaxLength + 50),
      });

      expect(reportMatch.mock.calls[0][1].details).toHaveLength(
        reportDetailsMaxLength,
      );
    });

    it("persists the normalised report form as durable context (issue #29, stories 62-63)", async () => {
      const { gateway, chat, reportContext } = buildGateway();
      await seedMatch(chat);
      // Exchange a line so the context snapshot has something to capture.
      await chat.send(INITIATOR.identity, { text: "hello" });
      const reporter = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleReport(reporter.socket, {
        category: "harassment_hate",
        details: "  abusive  ",
      });

      // The whole wire path — normalise, capture, end — left one durable record
      // against the reported user, carrying the trimmed details and the line.
      const [context] = await reportContext.forReported("guest:g1");
      expect(context.category).toBe("harassment_hate");
      expect(context.details).toBe("abusive");
      expect(context.transcript).toEqual([
        expect.objectContaining({ author: "reporter", text: "hello" }),
      ]);
    });
  });

  describe("reconnect grace (story 47)", () => {
    it("holds the match open on disconnect and warns the partner instead of ending", async () => {
      const { gateway, chat, delivered } = buildGateway();
      await seedMatch(chat);
      const dropped = fakeSocket(INITIATOR.socketId, INITIATOR.identity);

      await gateway.handleDisconnect(dropped.socket);

      // The partner is told to wait, not that the chat is over.
      const warn = delivered.find(
        (d) => d.event === CHAT_EVENTS.partnerDisconnected,
      );
      expect(warn?.to).toBe(RESPONDER.socketId);
      expect((warn?.payload as { graceSeconds: number }).graceSeconds).toBe(
        productConfig.reconnectGraceSeconds,
      );
      expect(
        delivered.find((d) => d.event === CHAT_EVENTS.matchEnded),
      ).toBeUndefined();
      // The match is still live for the remaining partner.
      expect(await chat.activeMatchFor(RESPONDER.identity)).not.toBeNull();
    });

    it("restores a reconnecting session and tells the partner they are back", async () => {
      const { gateway, chat, delivered } = buildGateway();
      await seedMatch(chat);
      await gateway.handleDisconnect(
        fakeSocket(INITIATOR.socketId, INITIATOR.identity).socket,
      );

      // The same identity reconnects on a fresh socket and asks to resume.
      const reconnected = fakeSocket("s-init-2", INITIATOR.identity);
      await gateway.handleResume(reconnected.socket);

      const resumed = reconnected.emitted.find(
        (e) => e.event === CHAT_EVENTS.resumed,
      );
      expect((resumed?.payload as { role: string }).role).toBe("initiator");
      const back = delivered.find(
        (d) => d.event === CHAT_EVENTS.partnerReconnected,
      );
      expect(back?.to).toBe(RESPONDER.socketId);
      // The match is still live and now routes to the new socket.
      expect(await chat.activeMatchFor(INITIATOR.identity)).not.toBeNull();
    });

    it("replays the messages a returning session missed while away", async () => {
      const { gateway, chat } = buildGateway();
      await seedMatch(chat);
      await gateway.handleDisconnect(
        fakeSocket(INITIATOR.socketId, INITIATOR.identity).socket,
      );

      // The still-present partner keeps chatting; the message buffers.
      await gateway.handleSend(
        fakeSocket(RESPONDER.socketId, RESPONDER.identity).socket,
        { text: "you still there?" },
      );

      const reconnected = fakeSocket("s-init-2", INITIATOR.identity);
      await gateway.handleResume(reconnected.socket);

      const resumed = reconnected.emitted.find(
        (e) => e.event === CHAT_EVENTS.resumed,
      );
      const buffer = (resumed?.payload as { buffer: Array<{ text: string }> })
        .buffer;
      expect(buffer.map((m) => m.text)).toEqual(["you still there?"]);
    });

    it("tells a session with no live match there is nothing to resume", async () => {
      const { gateway } = buildGateway();
      const lonely = fakeSocket("s-lonely", guest("g-lonely"));

      await gateway.handleResume(lonely.socket);

      expect(lonely.emitted).toContainEqual({
        event: CHAT_EVENTS.resumeFailed,
        payload: { reason: "no_active_match" },
      });
    });

    it("ends the match and tells the partner once the grace window lapses", async () => {
      jest.useFakeTimers();
      try {
        const { gateway, chat, delivered } = buildGateway();
        await seedMatch(chat);
        await gateway.handleDisconnect(
          fakeSocket(INITIATOR.socketId, INITIATOR.identity).socket,
        );

        await jest.advanceTimersByTimeAsync(
          productConfig.reconnectGraceSeconds * 1000,
        );

        const ended = delivered.find((d) => d.event === CHAT_EVENTS.matchEnded);
        expect(ended?.to).toBe(RESPONDER.socketId);
        expect((ended?.payload as { reason: string }).reason).toBe("timeout");
        expect(await chat.activeMatchFor(RESPONDER.identity)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not tear the match down if the session reconnects before the window lapses", async () => {
      jest.useFakeTimers();
      try {
        const { gateway, chat, delivered } = buildGateway();
        await seedMatch(chat);
        await gateway.handleDisconnect(
          fakeSocket(INITIATOR.socketId, INITIATOR.identity).socket,
        );

        // Reconnect well inside the window, then let the original timer fire.
        await jest.advanceTimersByTimeAsync(
          (productConfig.reconnectGraceSeconds - 1) * 1000,
        );
        await gateway.handleResume(
          fakeSocket("s-init-2", INITIATOR.identity).socket,
        );
        await jest.advanceTimersByTimeAsync(
          productConfig.reconnectGraceSeconds * 1000,
        );

        // The stale timer must not end a healthy, resumed chat.
        expect(
          delivered.find((d) => d.event === CHAT_EVENTS.matchEnded),
        ).toBeUndefined();
        expect(await chat.activeMatchFor(INITIATOR.identity)).not.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
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
