import type {
  GenderFilter,
  LanguageCode,
  UserGender,
} from "@fahhhchat/config";
import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import {
  identityKey,
  type MatchCriteria,
  type QueuedParticipant,
} from "./matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";

function participant(
  identity: RealtimeIdentity,
  socketId: string,
  enqueuedAt = Date.now(),
  language: LanguageCode = "en",
  gender: UserGender | null = null,
  genderFilter: GenderFilter = "both"
): QueuedParticipant {
  return { identity, socketId, enqueuedAt, language, gender, genderFilter };
}

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

/**
 * Match criteria with sensible defaults; a huge `relaxAfterMs` /
 * `genderRelaxAfterMs` disables relaxation on that axis. Gender filtering is on
 * by default but, with the default "both" filter and null gender, imposes no
 * constraint — so language-only tests behave exactly as before.
 */
function criteria(overrides: Partial<MatchCriteria>): MatchCriteria {
  return {
    excludeKey: overrides.excludeKey ?? "none",
    excludeKeys: overrides.excludeKeys ?? [],
    language: overrides.language ?? "en",
    now: overrides.now ?? Date.now(),
    relaxAfterMs: overrides.relaxAfterMs ?? Number.MAX_SAFE_INTEGER,
    genderFilteringEnabled: overrides.genderFilteringEnabled ?? true,
    gender: overrides.gender ?? null,
    genderFilter: overrides.genderFilter ?? "both",
    genderRelaxAfterMs: overrides.genderRelaxAfterMs ?? Number.MAX_SAFE_INTEGER,
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

  describe("gender-filtered matching (stories 31-33, 35)", () => {
    it("prefers a declared logged-in user of the filtered gender over a guest", async () => {
      // A guest (gender unknown) waits first, then a declared female user.
      await queue.enqueue(participant(guest("g1"), "s1", 1));
      await queue.enqueue(participant(user("f1"), "s2", 2, "en", "female"));

      // A male joiner filtering for women gets the female user, not the older
      // guest, even though the guest has been waiting longer.
      const taken = await queue.takeMatch(
        criteria({ gender: "male", genderFilter: "female" })
      );
      expect(taken?.identity).toEqual(user("f1"));
      // The guest is left waiting — a male/female filter is not met by a guest.
      expect(await queue.contains(identityKey(guest("g1")))).toBe(true);
    });

    it("does not match a guest while the filter holds (inside the window)", async () => {
      await queue.enqueue(participant(guest("g1"), "s1", 1000));

      // 5s waited, 20s gender window → the guest hasn't relaxed; a female-filtering
      // joiner waits rather than falling back to the gender-unknown guest.
      const taken = await queue.takeMatch(
        criteria({
          now: 6000,
          gender: "male",
          genderFilter: "female",
          genderRelaxAfterMs: 20_000,
        })
      );
      expect(taken).toBeNull();
      expect(await queue.size()).toBe(1);
    });

    it("falls back to a guest once the filtered waiter passes their window", async () => {
      // The filtered user is the one *waiting*: a male user who wants women.
      await queue.enqueue(
        participant(user("m1"), "s1", 1000, "en", "male", "female")
      );

      // 25s ≥ 20s window: m1 has relaxed past their gender window, so a joining
      // guest (gender unknown) now pairs with them — the visible fall-back to
      // guests after the wait window (stories 33, 35). The joiner's own full
      // strength "both" filter accepts m1.
      const taken = await queue.takeMatch(
        criteria({
          now: 26_000,
          gender: null,
          genderFilter: "both",
          genderRelaxAfterMs: 20_000,
        })
      );
      expect(taken?.identity).toEqual(user("m1"));
    });

    it("respects a waiting user's own filter until their window lapses", async () => {
      // A waiting female user who only wants to meet women.
      await queue.enqueue(
        participant(user("f1"), "s1", 1000, "en", "female", "female")
      );

      // A male joiner (no filter) does not satisfy her filter and she hasn't
      // relaxed (5s < 20s) → no match, her strong preference is honored.
      const inside = await queue.takeMatch(
        criteria({
          now: 6000,
          gender: "male",
          genderFilter: "both",
          genderRelaxAfterMs: 20_000,
        })
      );
      expect(inside).toBeNull();

      // After her window lapses she relaxes and accepts the male joiner.
      const after = await queue.takeMatch(
        criteria({
          now: 26_000,
          gender: "male",
          genderFilter: "both",
          genderRelaxAfterMs: 20_000,
        })
      );
      expect(after?.identity).toEqual(user("f1"));
    });

    it("ignores all gender filters when filtering is disabled (kill switch)", async () => {
      // A waiting female user who filters for women only.
      await queue.enqueue(
        participant(user("f1"), "s1", 1, "en", "female", "female")
      );

      // With filtering off, a male joiner filtering for men still pairs with her
      // immediately — every gender constraint is ignored (story 84).
      const taken = await queue.takeMatch(
        criteria({
          gender: "male",
          genderFilter: "male",
          genderFilteringEnabled: false,
        })
      );
      expect(taken?.identity).toEqual(user("f1"));
    });
  });
});
