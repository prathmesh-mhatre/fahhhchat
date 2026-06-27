import type { ActiveMatch, ChatMessage } from "./chat.types";
import { InMemoryChatStore } from "./in-memory-chat.store";

function activeMatch(
  matchId: string,
  a: { key: string; socketId: string },
  b: { key: string; socketId: string },
): ActiveMatch {
  return {
    matchId,
    createdAt: new Date().toISOString(),
    participants: [
      {
        identityKey: a.key,
        role: "initiator",
        socketId: a.socketId,
        displayName: "Mellow Otter",
        connected: true,
      },
      {
        identityKey: b.key,
        role: "responder",
        socketId: b.socketId,
        displayName: "Cosmic Sparrow",
        connected: true,
      },
    ],
  };
}

function message(matchId: string, text: string): ChatMessage {
  return {
    matchId,
    messageId: `${matchId}-${text}`,
    from: "initiator",
    text,
    sentAt: new Date().toISOString(),
  };
}

describe("InMemoryChatStore", () => {
  const a = { key: "user:u1", socketId: "s-a" };
  const b = { key: "guest:g1", socketId: "s-b" };

  it("indexes a match by id, identity, and socket", async () => {
    const store = new InMemoryChatStore();
    const match = activeMatch("m1", a, b);
    await store.createMatch(match);

    expect((await store.getMatchByIdentity(a.key))?.matchId).toBe("m1");
    expect((await store.getMatchBySocket(b.socketId))?.matchId).toBe("m1");
  });

  it("removes every index when a match is torn down", async () => {
    const store = new InMemoryChatStore();
    await store.createMatch(activeMatch("m1", a, b));

    const removed = await store.removeMatch("m1");

    expect(removed?.matchId).toBe("m1");
    expect(await store.getMatchByIdentity(a.key)).toBeNull();
    expect(await store.getMatchByIdentity(b.key)).toBeNull();
    expect(await store.getMatchBySocket(a.socketId)).toBeNull();
    expect(await store.getBuffer("m1")).toHaveLength(0);
  });

  it("drops a match's buffer on teardown so history cannot outlive it", async () => {
    const store = new InMemoryChatStore();
    await store.createMatch(activeMatch("m1", a, b));
    await store.appendMessage("m1", message("m1", "hi"));

    await store.removeMatch("m1");

    expect(await store.getBuffer("m1")).toHaveLength(0);
  });

  it("ignores appends to an unknown match", async () => {
    const store = new InMemoryChatStore();

    await store.appendMessage("ghost", message("ghost", "nobody home"));

    expect(await store.getBuffer("ghost")).toHaveLength(0);
  });

  it("caps the buffer to the newest window", async () => {
    const store = new InMemoryChatStore(2);
    await store.createMatch(activeMatch("m1", a, b));

    for (const text of ["1", "2", "3"]) {
      await store.appendMessage("m1", message("m1", text));
    }

    expect((await store.getBuffer("m1")).map((m) => m.text)).toEqual([
      "2",
      "3",
    ]);
  });

  describe("reconnect grace (story 47)", () => {
    it("marks a dropped socket disconnected, drops its socket index, and keeps the match", async () => {
      const store = new InMemoryChatStore();
      await store.createMatch(activeMatch("m1", a, b));

      const mark = await store.markDisconnected(a.socketId, "2026-06-27T00:00:25Z");

      expect(mark?.participantKey).toBe(a.key);
      expect(mark?.partner.identityKey).toBe(b.key);
      // The match still routes by identity, but the dead socket no longer does.
      expect((await store.getMatchByIdentity(a.key))?.matchId).toBe("m1");
      expect(await store.getMatchBySocket(a.socketId)).toBeNull();
      const self = (await store.getMatchByIdentity(a.key))?.participants.find(
        (p) => p.identityKey === a.key,
      );
      expect(self?.connected).toBe(false);
      expect(self?.graceExpiresAt).toBe("2026-06-27T00:00:25Z");
    });

    it("returns null when the dropped socket was in no match", async () => {
      const store = new InMemoryChatStore();
      expect(await store.markDisconnected("ghost", "t")).toBeNull();
    });

    it("rebinds a reconnecting identity to a fresh socket and clears grace", async () => {
      const store = new InMemoryChatStore();
      await store.createMatch(activeMatch("m1", a, b));
      await store.markDisconnected(a.socketId, "2026-06-27T00:00:25Z");

      const match = await store.reattach(a.key, "s-a2");

      expect(match?.matchId).toBe("m1");
      // The new socket routes; the old one stays retired.
      expect((await store.getMatchBySocket("s-a2"))?.matchId).toBe("m1");
      expect(await store.getMatchBySocket(a.socketId)).toBeNull();
      const self = match?.participants.find((p) => p.identityKey === a.key);
      expect(self?.connected).toBe(true);
      expect(self?.socketId).toBe("s-a2");
      expect(self?.graceExpiresAt).toBeUndefined();
    });

    it("returns null when reattaching an identity with no live match", async () => {
      const store = new InMemoryChatStore();
      expect(await store.reattach("user:nobody", "s-x")).toBeNull();
    });
  });

  it("keeps a participant's newer match when an old one with the same identity is torn down", async () => {
    // A user who matched again (e.g. after a partner left) is re-indexed onto the
    // new match. Tearing down the *old* match must not orphan the new routing.
    const store = new InMemoryChatStore();
    await store.createMatch(activeMatch("m1", a, b));
    const c = { key: "guest:g2", socketId: "s-c" };
    await store.createMatch(activeMatch("m2", a, c));

    await store.removeMatch("m1");

    expect((await store.getMatchByIdentity(a.key))?.matchId).toBe("m2");
  });
});
