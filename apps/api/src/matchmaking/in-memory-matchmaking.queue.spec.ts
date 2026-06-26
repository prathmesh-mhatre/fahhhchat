import type { LanguageCode } from "@fahhhchat/config";
import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import { identityKey, type QueuedParticipant } from "./matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";

function participant(
  identity: RealtimeIdentity,
  socketId: string,
  enqueuedAt = Date.now(),
  language: LanguageCode = "en"
): QueuedParticipant {
  return { identity, socketId, enqueuedAt, language };
}

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

/** Match criteria with sensible defaults; a huge `relaxAfterMs` disables relaxation. */
function criteria(overrides: {
  excludeKey?: string;
  language?: LanguageCode;
  now?: number;
  relaxAfterMs?: number;
}) {
  return {
    excludeKey: overrides.excludeKey ?? "none",
    language: overrides.language ?? "en",
    now: overrides.now ?? Date.now(),
    relaxAfterMs: overrides.relaxAfterMs ?? Number.MAX_SAFE_INTEGER,
  };
}

describe("InMemoryMatchmakingQueue", () => {
  let queue: InMemoryMatchmakingQueue;

  beforeEach(() => {
    queue = new InMemoryMatchmakingQueue();
  });

  it("enqueues new identities and reports membership and size", async () => {
    expect(await queue.enqueue(participant(guest("g1"), "s1"))).toBe(true);
    expect(await queue.enqueue(participant(user("u1"), "s2"))).toBe(true);

    expect(await queue.size()).toBe(2);
    expect(await queue.contains(identityKey(guest("g1")))).toBe(true);
    expect(await queue.contains(identityKey(user("missing")))).toBe(false);
  });

  it("keeps a single slot per identity on re-enqueue (reconnect)", async () => {
    expect(await queue.enqueue(participant(guest("g1"), "s1"))).toBe(true);
    // Same identity, new socket — not counted as new, no duplicate slot.
    expect(await queue.enqueue(participant(guest("g1"), "s2"))).toBe(false);
    expect(await queue.size()).toBe(1);
  });

  it("takes the oldest same-language waiter, skipping the excluded key", async () => {
    await queue.enqueue(participant(guest("g1"), "s1", 1));
    await queue.enqueue(participant(user("u1"), "s2", 2));

    // Excluding the oldest forces the next-oldest same-language one to return.
    const taken = await queue.takeMatch(
      criteria({ excludeKey: identityKey(guest("g1")), language: "en" })
    );
    expect(taken?.identity).toEqual(user("u1"));
    expect(await queue.size()).toBe(1);
    expect(await queue.contains(identityKey(guest("g1")))).toBe(true);
  });

  it("returns the genuine oldest first (FIFO) within the same language", async () => {
    await queue.enqueue(participant(guest("g1"), "s1", 1));
    await queue.enqueue(participant(guest("g2"), "s2", 2));

    const first = await queue.takeMatch(criteria({ language: "en" }));
    expect(first?.identity).toEqual(guest("g1"));
  });

  it("returns null when the only waiter is the excluded one", async () => {
    await queue.enqueue(participant(guest("g1"), "s1"));
    expect(
      await queue.takeMatch(criteria({ excludeKey: identityKey(guest("g1")) }))
    ).toBeNull();
  });

  it("prefers a same-language waiter over an older different-language one", async () => {
    // An older Spanish speaker and a newer English speaker both wait; an English
    // joiner should get the English speaker even though they arrived later.
    await queue.enqueue(participant(guest("es"), "s1", 1, "es"));
    await queue.enqueue(participant(guest("en"), "s2", 2, "en"));

    const taken = await queue.takeMatch(criteria({ language: "en" }));
    expect(taken?.identity).toEqual(guest("en"));
    // The Spanish speaker is left waiting (still inside its relax window).
    expect(await queue.contains(identityKey(guest("es")))).toBe(true);
  });

  it("leaves a different-language waiter who is still inside the relax window", async () => {
    await queue.enqueue(participant(guest("es"), "s1", 1000, "es"));

    // now - enqueuedAt = 5s, below a 15s relax window → no cross-language match.
    const taken = await queue.takeMatch(
      criteria({ language: "en", now: 6000, relaxAfterMs: 15_000 })
    );
    expect(taken).toBeNull();
    expect(await queue.size()).toBe(1);
  });

  it("relaxes across languages once a waiter passes the relax window", async () => {
    await queue.enqueue(participant(guest("es"), "s1", 1000, "es"));

    // now - enqueuedAt = 20s ≥ 15s window → the Spanish speaker is now eligible.
    const taken = await queue.takeMatch(
      criteria({ language: "en", now: 21_000, relaxAfterMs: 15_000 })
    );
    expect(taken?.identity).toEqual(guest("es"));
    expect(await queue.size()).toBe(0);
  });

  it("takes the oldest relaxed waiter when several have passed the window", async () => {
    await queue.enqueue(participant(guest("es"), "s1", 1000, "es"));
    await queue.enqueue(participant(guest("fr"), "s2", 2000, "fr"));

    const taken = await queue.takeMatch(
      criteria({ language: "en", now: 30_000, relaxAfterMs: 15_000 })
    );
    expect(taken?.identity).toEqual(guest("es"));
  });

  it("moves a reconnecting identity to the tail so it does not jump the queue", async () => {
    await queue.enqueue(participant(guest("g1"), "s1", 1));
    await queue.enqueue(participant(guest("g2"), "s2", 2));
    // g1 reconnects; it should now be behind g2.
    await queue.enqueue(participant(guest("g1"), "s1b", 3));

    const first = await queue.takeMatch(criteria({ language: "en" }));
    expect(first?.identity).toEqual(guest("g2"));
  });

  it("removes by identity key and reports whether one was waiting", async () => {
    await queue.enqueue(participant(guest("g1"), "s1"));
    expect(await queue.remove(identityKey(guest("g1")))).toBe(true);
    expect(await queue.remove(identityKey(guest("g1")))).toBe(false);
    expect(await queue.size()).toBe(0);
  });

  it("removes by socket id and returns the freed identity key", async () => {
    await queue.enqueue(participant(user("u1"), "sock-1"));
    expect(await queue.removeBySocket("sock-1")).toBe(identityKey(user("u1")));
    expect(await queue.removeBySocket("sock-unknown")).toBeNull();
    expect(await queue.size()).toBe(0);
  });
});
