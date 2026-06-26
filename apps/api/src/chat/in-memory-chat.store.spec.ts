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
      { identityKey: a.key, role: "initiator", socketId: a.socketId },
      { identityKey: b.key, role: "responder", socketId: b.socketId },
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
