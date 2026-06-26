import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import { identityKey, type QueuedParticipant } from "./matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";

function participant(
  identity: RealtimeIdentity,
  socketId: string,
  enqueuedAt = Date.now()
): QueuedParticipant {
  return { identity, socketId, enqueuedAt };
}

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

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

  it("takes the oldest waiting participant, skipping the excluded key", async () => {
    await queue.enqueue(participant(guest("g1"), "s1", 1));
    await queue.enqueue(participant(user("u1"), "s2", 2));

    // Excluding the oldest forces the next-oldest to be returned.
    const taken = await queue.takeOldestExcept(identityKey(guest("g1")));
    expect(taken?.identity).toEqual(user("u1"));
    expect(await queue.size()).toBe(1);
    expect(await queue.contains(identityKey(guest("g1")))).toBe(true);
  });

  it("returns the genuine oldest first (FIFO) when nobody is excluded", async () => {
    await queue.enqueue(participant(guest("g1"), "s1", 1));
    await queue.enqueue(participant(guest("g2"), "s2", 2));

    const first = await queue.takeOldestExcept("none");
    expect(first?.identity).toEqual(guest("g1"));
  });

  it("returns null when the only waiter is the excluded one", async () => {
    await queue.enqueue(participant(guest("g1"), "s1"));
    expect(await queue.takeOldestExcept(identityKey(guest("g1")))).toBeNull();
  });

  it("moves a reconnecting identity to the tail so it does not jump the queue", async () => {
    await queue.enqueue(participant(guest("g1"), "s1", 1));
    await queue.enqueue(participant(guest("g2"), "s2", 2));
    // g1 reconnects; it should now be behind g2.
    await queue.enqueue(participant(guest("g1"), "s1b", 3));

    const first = await queue.takeOldestExcept("none");
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
