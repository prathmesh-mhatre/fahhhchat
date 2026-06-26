import { productConfig } from "@fahhhchat/config";
import type {
  Match,
  QueuedParticipant,
} from "../matchmaking/matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import { ChatService } from "./chat.service";
import type { DisplayNameResolver } from "./chat.types";
import { InMemoryChatStore } from "./in-memory-chat.store";

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

/**
 * Stub resolver mapping a participant's identity to a fixed generated name, so
 * typing assertions can check the *exact* name the chat layer froze on the
 * match. Defaults to `<kind>:<id>` for any identity not named explicitly.
 */
function stubResolver(
  names: Partial<Record<string, string>> = {},
): DisplayNameResolver {
  return {
    async resolve(identity) {
      const key = `${identity.kind}:${identity.id}`;
      return names[key] ?? key;
    },
  };
}

/** Minimal queued participant; only identity + socket matter to chat routing. */
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

/** A created match between two sockets, as matchmaking would hand it over. */
function match(
  initiator: { identity: RealtimeIdentity; socketId: string },
  responder: { identity: RealtimeIdentity; socketId: string },
  matchId = "m1",
): Match {
  return {
    matchId,
    createdAt: new Date("2026-06-26T00:00:00.000Z").toISOString(),
    initiator: participant(initiator.identity, initiator.socketId),
    responder: participant(responder.identity, responder.socketId),
  };
}

function buildService(resolver: DisplayNameResolver = stubResolver()) {
  const service = new ChatService(new InMemoryChatStore(), resolver);
  return { service };
}

describe("ChatService", () => {
  const initiator = { identity: user("u1"), socketId: "s-init" };
  const responder = { identity: guest("g1"), socketId: "s-resp" };

  describe("send", () => {
    it("delivers a message to the partner and stamps a server id + timestamp (story 39)", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const now = new Date("2026-06-26T12:00:00.000Z");
      const result = await service.send(
        initiator.identity,
        { text: "hello there" },
        now,
      );

      expect(result.status).toBe("delivered");
      if (result.status !== "delivered") return;
      // Routed to the *partner's* socket, never echoed to the sender.
      expect(result.recipientSocketId).toBe(responder.socketId);
      expect(result.message.from).toBe("initiator");
      expect(result.message.text).toBe("hello there");
      expect(result.message.sentAt).toBe(now.toISOString());
      expect(result.message.messageId).toMatch(/[0-9a-f-]{36}/);
    });

    it("routes a reply from the other side to the first sender", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const result = await service.send(responder.identity, {
        text: "hi back",
      });

      expect(result.status).toBe("delivered");
      if (result.status !== "delivered") return;
      expect(result.recipientSocketId).toBe(initiator.socketId);
      expect(result.message.from).toBe("responder");
    });

    it("appends delivered messages to the ephemeral match buffer (story 46)", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);

      await service.send(initiator.identity, { text: "one" });
      await service.send(responder.identity, { text: "two" });

      const buffer = await service.buffer(created.matchId);
      expect(buffer.map((m) => m.text)).toEqual(["one", "two"]);
    });

    it("trims whitespace and rejects an empty/blank message", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const blank = await service.send(initiator.identity, { text: "   " });
      expect(blank).toEqual({ status: "invalid", reason: "empty" });

      const trimmed = await service.send(initiator.identity, {
        text: "  spaced  ",
      });
      expect(trimmed.status).toBe("delivered");
      if (trimmed.status !== "delivered") return;
      expect(trimmed.message.text).toBe("spaced");
    });

    it("rejects a message longer than the shared max length", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const tooLong = "x".repeat(productConfig.chatMessageMaxLength + 1);
      const result = await service.send(initiator.identity, { text: tooLong });

      expect(result).toEqual({ status: "invalid", reason: "too_long" });
      // A rejected message is never buffered.
      expect(await service.buffer("m1")).toHaveLength(0);
    });

    it("refuses to deliver when the sender is in no active match (story 43)", async () => {
      const { service } = buildService();

      const result = await service.send(user("nobody"), { text: "hello?" });

      expect(result).toEqual({ status: "no_active_match" });
    });

    it("refuses to deliver once the match has ended (story 43)", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);
      await service.endMatch(created.matchId, "partner_disconnected");

      const result = await service.send(initiator.identity, {
        text: "too late",
      });

      expect(result).toEqual({ status: "no_active_match" });
    });
  });

  describe("ending a match", () => {
    it("drops the match and its buffer so history disappears (story 46)", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);
      await service.send(initiator.identity, { text: "kept only while live" });

      await service.endMatch(created.matchId, "partner_disconnected");

      expect(await service.activeMatchFor(initiator.identity)).toBeNull();
      expect(await service.activeMatchFor(responder.identity)).toBeNull();
      expect(await service.buffer(created.matchId)).toHaveLength(0);
    });

    it("ends the match a disconnecting socket held and reports the partner to notify", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const ended = await service.endMatchForSocket(
        initiator.socketId,
        "partner_disconnected",
      );

      expect(ended).not.toBeNull();
      // Only the *remaining* partner is notified, not the socket that left.
      expect(ended?.notifySocketIds).toEqual([responder.socketId]);
      expect(ended?.reason).toBe("partner_disconnected");
    });

    it("is a no-op when a socket that never chatted disconnects", async () => {
      const { service } = buildService();

      const ended = await service.endMatchForSocket(
        "stranger-socket",
        "partner_disconnected",
      );

      expect(ended).toBeNull();
    });

    it("is idempotent when the match is already gone", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);

      await service.endMatch(created.matchId, "partner_disconnected");
      const second = await service.endMatch(
        created.matchId,
        "partner_disconnected",
      );

      expect(second).toBeNull();
    });
  });

  describe("typing (story 40)", () => {
    it("relays a typing toggle to the partner with the sender's frozen name", async () => {
      const resolver = stubResolver({ "user:u1": "Mellow Otter" });
      const { service } = buildService(resolver);
      await service.registerMatch(match(initiator, responder));

      const result = await service.typing(initiator.identity, true);

      expect(result).toEqual({
        status: "relay",
        matchId: "m1",
        // Routed to the *partner's* socket, never echoed to the typist.
        recipientSocketId: responder.socketId,
        from: "initiator",
        displayName: "Mellow Otter",
        isTyping: true,
      });
    });

    it("carries the stop toggle through the same relay", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const result = await service.typing(responder.identity, false);

      expect(result.status).toBe("relay");
      if (result.status !== "relay") return;
      expect(result.recipientSocketId).toBe(initiator.socketId);
      expect(result.from).toBe("responder");
      expect(result.isTyping).toBe(false);
    });

    it("drops a typing toggle when the sender is in no active match (story 43)", async () => {
      const { service } = buildService();

      const result = await service.typing(user("nobody"), true);

      expect(result).toEqual({ status: "no_active_match" });
    });

    it("drops a typing toggle once the match has ended", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);
      await service.endMatch(created.matchId, "partner_disconnected");

      const result = await service.typing(initiator.identity, true);

      expect(result).toEqual({ status: "no_active_match" });
    });

    it("falls back to a neutral name when the sender's name can't be resolved", async () => {
      const resolver: DisplayNameResolver = { async resolve() { return null; } };
      const { service } = buildService(resolver);
      await service.registerMatch(match(initiator, responder));

      const result = await service.typing(initiator.identity, true);

      expect(result.status).toBe("relay");
      if (result.status !== "relay") return;
      expect(result.displayName).toBe("Stranger");
    });
  });

  it("keeps the buffer bounded to the rolling window", async () => {
    // A tiny buffer makes the cap observable without sending hundreds of messages.
    const service = new ChatService(new InMemoryChatStore(3), stubResolver());
    const created = match(initiator, responder);
    await service.registerMatch(created);

    for (const text of ["a", "b", "c", "d", "e"]) {
      await service.send(initiator.identity, { text });
    }

    const buffer = await service.buffer(created.matchId);
    expect(buffer.map((m) => m.text)).toEqual(["c", "d", "e"]);
  });
});
