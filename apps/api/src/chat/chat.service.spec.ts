import { productConfig, rateLimits } from "@fahhhchat/config";
import type {
  Match,
  QueuedParticipant,
} from "../matchmaking/matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory-rate-limit.store";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { InMemoryRematchGuardStore } from "../rematch/in-memory-rematch-guard.store";
import { RematchGuardService } from "../rematch/rematch-guard.service";
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
  const rateLimits = new RateLimitService(new InMemoryRateLimitStore());
  const rematchGuard = new RematchGuardService(new InMemoryRematchGuardStore());
  const service = new ChatService(
    new InMemoryChatStore(),
    resolver,
    rateLimits,
    rematchGuard,
  );
  return { service, rateLimits, rematchGuard };
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

  describe("link-spam control (story 45)", () => {
    // The guest tier's chat_link budget; the responder (g1) is a guest.
    const guestLinkLimit = rateLimits.chat_link.guest.limit;
    const now = new Date("2026-06-26T12:00:00.000Z");

    it("delivers a URL-bearing message while under the link budget", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const result = await service.send(
        responder.identity,
        { text: "check https://example.com out" },
        now,
      );

      // The link is delivered verbatim — URLs are never stripped or rewritten;
      // the recipient renders them as inert text (story 44).
      expect(result.status).toBe("delivered");
      if (result.status !== "delivered") return;
      expect(result.message.text).toBe("check https://example.com out");
    });

    it("refuses a URL-bearing message once the sender exhausts the link budget", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      // Spend the whole budget on link messages; each is delivered.
      for (let i = 0; i < guestLinkLimit; i += 1) {
        const ok = await service.send(
          responder.identity,
          { text: `link ${i} spam.example.com` },
          now,
        );
        expect(ok.status).toBe("delivered");
      }

      // The next link message is refused as spam, with a wait hint.
      const blocked = await service.send(
        responder.identity,
        { text: "one more evil.example.com" },
        now,
      );

      expect(blocked.status).toBe("spam");
      if (blocked.status !== "spam") return;
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      // A refused message is never buffered or delivered.
      const buffer = await service.buffer("m1");
      expect(buffer.every((m) => !m.text.includes("one more"))).toBe(true);
    });

    it("never throttles ordinary (link-free) messages, even after the budget is spent", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      // Exhaust the link budget...
      for (let i = 0; i <= guestLinkLimit; i += 1) {
        await service.send(
          responder.identity,
          { text: `spam ${i} bad.example.com` },
          now,
        );
      }

      // ...a plain message still goes through: only link-bearing sends are metered.
      const plain = await service.send(
        responder.identity,
        { text: "just talking, no links here" },
        now,
      );
      expect(plain.status).toBe("delivered");
    });

    it("meters each sender's link budget independently", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      // The guest responder spends its entire budget...
      for (let i = 0; i <= guestLinkLimit; i += 1) {
        await service.send(
          responder.identity,
          { text: `r ${i} bad.example.com` },
          now,
        );
      }

      // ...which must not spill onto the initiator's separate budget.
      const fromInitiator = await service.send(
        initiator.identity,
        { text: "my first link example.com" },
        now,
      );
      expect(fromInitiator.status).toBe("delivered");
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

  describe("confirmed Next (issue #26, story 51)", () => {
    it("ends the caller's match with reason `next` and notifies only the partner", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);

      const ended = await service.nextMatch(initiator.identity);

      expect(ended).not.toBeNull();
      expect(ended?.reason).toBe("next");
      // The Next-clicker's own socket is excluded — its client already moved on
      // and is about to requeue — so only the stranger is told the chat ended.
      expect(ended?.notifySocketIds).toEqual([responder.socketId]);
    });

    it("tears the match (and its buffer) down so no further send routes", async () => {
      const { service } = buildService();
      const created = match(initiator, responder);
      await service.registerMatch(created);
      await service.send(initiator.identity, { text: "gone after next" });

      await service.nextMatch(responder.identity);

      expect(await service.activeMatchFor(initiator.identity)).toBeNull();
      expect(await service.activeMatchFor(responder.identity)).toBeNull();
      expect(await service.buffer(created.matchId)).toHaveLength(0);
    });

    it("notifies the partner when the *responder* clicks Next", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const ended = await service.nextMatch(responder.identity);

      expect(ended?.notifySocketIds).toEqual([initiator.socketId]);
    });

    it("is a no-op when the caller is not in a live match", async () => {
      const { service } = buildService();

      expect(await service.nextMatch(initiator.identity)).toBeNull();
    });

    it("is idempotent under a double Next (the match is already gone)", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      await service.nextMatch(initiator.identity);
      expect(await service.nextMatch(initiator.identity)).toBeNull();
    });
  });

  describe("report and block (issue #27, stories 52-56)", () => {
    const initiatorKey = "user:u1";
    const responderKey = "guest:g1";

    it("reporting ends the match with reason `report` and notifies only the partner (story 52)", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const ended = await service.reportMatch(initiator.identity, true);

      expect(ended?.reason).toBe("report");
      // The reporter's own socket is excluded — like Next, their client already
      // transitioned — so only the stranger is told the chat ended.
      expect(ended?.notifySocketIds).toEqual([responder.socketId]);
      // And the match is torn down so no further send routes.
      expect(await service.activeMatchFor(initiator.identity)).toBeNull();
      expect(await service.activeMatchFor(responder.identity)).toBeNull();
    });

    it("blocking ends the match with reason `block` and notifies only the partner (story 53)", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const ended = await service.blockMatch(responder.identity);

      expect(ended?.reason).toBe("block");
      expect(ended?.notifySocketIds).toEqual([initiator.socketId]);
    });

    it("reporting with also-block records a mutual rematch-prevention block (stories 54, 56)", async () => {
      const { service, rematchGuard } = buildService();
      await service.registerMatch(match(initiator, responder));

      await service.reportMatch(initiator.identity, true);

      // Mutual: each side now excludes the other, regardless of who later joins.
      expect(await rematchGuard.excludedKeysFor(initiatorKey)).toEqual([
        responderKey,
      ]);
      expect(await rematchGuard.excludedKeysFor(responderKey)).toEqual([
        initiatorKey,
      ]);
    });

    it("reporting *without* also-block ends the match but records no exclusion (story 56)", async () => {
      const { service, rematchGuard } = buildService();
      await service.registerMatch(match(initiator, responder));

      const ended = await service.reportMatch(initiator.identity, false);

      expect(ended?.reason).toBe("report");
      // No block requested, so the two can be paired again immediately.
      expect(await rematchGuard.excludedKeysFor(initiatorKey)).toEqual([]);
      expect(await rematchGuard.excludedKeysFor(responderKey)).toEqual([]);
    });

    it("blocking always records the rematch-prevention block (story 54)", async () => {
      const { service, rematchGuard } = buildService();
      await service.registerMatch(match(initiator, responder));

      await service.blockMatch(initiator.identity);

      expect(await rematchGuard.excludedKeysFor(initiatorKey)).toEqual([
        responderKey,
      ]);
      expect(await rematchGuard.excludedKeysFor(responderKey)).toEqual([
        initiatorKey,
      ]);
    });

    it("are no-ops when the caller is not in a live match", async () => {
      const { service, rematchGuard } = buildService();

      expect(await service.reportMatch(initiator.identity, true)).toBeNull();
      expect(await service.blockMatch(initiator.identity)).toBeNull();
      // Nothing recorded, since there was no partner to block.
      expect(await rematchGuard.excludedKeysFor(initiatorKey)).toEqual([]);
    });
  });

  describe("reconnect grace (story 47)", () => {
    const t0 = new Date("2026-06-26T12:00:00.000Z");
    /** A time `seconds` after t0. */
    const at = (seconds: number) =>
      new Date(t0.getTime() + seconds * 1000);
    const afterGrace = at(productConfig.reconnectGraceSeconds + 1);

    it("holds the match open and reports the partner to warn when a socket drops", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      const result = await service.beginReconnectGrace(initiator.socketId, t0);

      expect(result.status).toBe("grace");
      if (result.status !== "grace") return;
      expect(result.matchId).toBe("m1");
      expect(result.participantKey).toBe("user:u1");
      expect(result.partnerSocketId).toBe(responder.socketId);
      // The match is NOT torn down — the partner can still be looked up.
      expect(await service.activeMatchFor(responder.identity)).not.toBeNull();
    });

    it("is a no-op for a socket that was never in a match", async () => {
      const { service } = buildService();
      const result = await service.beginReconnectGrace("ghost", t0);
      expect(result).toEqual({ status: "none" });
    });

    it("ends the match immediately if the partner is already away", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));

      // Initiator drops (grace), then responder drops too: nobody left to wait for.
      await service.beginReconnectGrace(initiator.socketId, t0);
      const result = await service.beginReconnectGrace(responder.socketId, at(1));

      expect(result.status).toBe("ended");
      if (result.status !== "ended") return;
      expect(await service.activeMatchFor(initiator.identity)).toBeNull();
    });

    it("buffers a partner's messages while a participant is away, and replays them on resume", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);

      // The still-present responder keeps chatting; the message buffers.
      await service.send(responder.identity, { text: "you there?" }, at(2));

      const resumed = await service.resume(initiator.identity, "s-init-2", at(5));

      expect(resumed.status).toBe("resumed");
      if (resumed.status !== "resumed") return;
      expect(resumed.role).toBe("initiator");
      expect(resumed.partnerConnected).toBe(true);
      expect(resumed.partnerSocketId).toBe(responder.socketId);
      expect(resumed.buffer.map((m) => m.text)).toEqual(["you there?"]);
    });

    it("routes to the reconnected participant's new socket after resume", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);
      await service.resume(initiator.identity, "s-init-2", at(5));

      // The responder's next message now targets the fresh socket, not the dead one.
      const delivered = await service.send(
        responder.identity,
        { text: "welcome back" },
        at(6),
      );
      expect(delivered.status).toBe("delivered");
      if (delivered.status !== "delivered") return;
      expect(delivered.recipientSocketId).toBe("s-init-2");
    });

    it("refuses a resume once the grace window has lapsed, and reaps the match", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);

      const result = await service.resume(
        initiator.identity,
        "s-init-2",
        afterGrace,
      );

      expect(result.status).toBe("no_active_match");
      if (result.status !== "no_active_match") return;
      // The lingering match is torn down and the partner is reported to notify.
      expect(result.ended?.reason).toBe("timeout");
      expect(result.ended?.notifySocketIds).toEqual([responder.socketId]);
      expect(await service.activeMatchFor(responder.identity)).toBeNull();
    });

    it("ends the match with timeout when the grace window expires", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);

      const ended = await service.expireReconnectGrace(
        "m1",
        "user:u1",
        afterGrace,
      );

      expect(ended?.reason).toBe("timeout");
      expect(ended?.notifySocketIds).toEqual([responder.socketId]);
      expect(await service.activeMatchFor(responder.identity)).toBeNull();
    });

    it("does not expire a participant who reconnected in time", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);
      await service.resume(initiator.identity, "s-init-2", at(5));

      const ended = await service.expireReconnectGrace(
        "m1",
        "user:u1",
        afterGrace,
      );

      expect(ended).toBeNull();
      expect(await service.activeMatchFor(initiator.identity)).not.toBeNull();
    });

    it("does not expire before the deadline has actually passed", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);

      const ended = await service.expireReconnectGrace("m1", "user:u1", at(5));

      expect(ended).toBeNull();
    });

    it("only the same session can resume — a different identity cannot", async () => {
      const { service } = buildService();
      await service.registerMatch(match(initiator, responder));
      await service.beginReconnectGrace(initiator.socketId, t0);

      const result = await service.resume(user("intruder"), "s-evil", at(5));

      expect(result).toEqual({ status: "no_active_match", ended: null });
      // The genuine session can still resume afterwards.
      const genuine = await service.resume(initiator.identity, "s-init-2", at(6));
      expect(genuine.status).toBe("resumed");
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
    const service = new ChatService(
      new InMemoryChatStore(3),
      stubResolver(),
      new RateLimitService(new InMemoryRateLimitStore()),
      new RematchGuardService(new InMemoryRematchGuardStore()),
    );
    const created = match(initiator, responder);
    await service.registerMatch(created);

    for (const text of ["a", "b", "c", "d", "e"]) {
      await service.send(initiator.identity, { text });
    }

    const buffer = await service.buffer(created.matchId);
    expect(buffer.map((m) => m.text)).toEqual(["c", "d", "e"]);
  });
});
