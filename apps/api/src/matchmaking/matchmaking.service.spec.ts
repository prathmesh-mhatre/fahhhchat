import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory-rate-limit.store";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { InMemoryRematchGuardStore } from "../rematch/in-memory-rematch-guard.store";
import { RematchGuardService } from "../rematch/rematch-guard.service";
import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import { MatchmakingService } from "./matchmaking.service";
import type { RealtimeIdentity } from "../realtime/realtime.types";

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

/** Build the service over real (in-memory) collaborators; all kill switches start on. */
function buildService(disabled: Array<"queue_entry" | "gender_filters"> = []) {
  const flags = new FeatureFlagsService(
    new InMemoryFeatureFlagStore(disabled),
    new InMemoryFeatureFlagAuditLog()
  );
  const queue = new InMemoryMatchmakingQueue();
  const rateLimits = new RateLimitService(new InMemoryRateLimitStore());
  const rematchGuard = new RematchGuardService(new InMemoryRematchGuardStore());
  return {
    service: new MatchmakingService(queue, flags, rateLimits, rematchGuard),
    queue,
    flags,
    rateLimits,
    rematchGuard,
  };
}

describe("MatchmakingService (stories 24-25, 37-38)", () => {
  it("queues the first joiner and matches the second into a shared pool", async () => {
    const { service } = buildService();

    const first = await service.join(guest("g1"), "s1");
    expect(first.status).toBe("queued");

    // A logged-in user joins the *same* pool and pairs with the waiting guest
    // (one shared pool for guests + logged-in users, stories 24-25).
    const second = await service.join(user("u1"), "s2");
    expect(second.status).toBe("matched");
    if (second.status !== "matched") {
      throw new Error("expected a match");
    }
    expect(second.match.initiator.identity).toEqual(user("u1"));
    expect(second.match.responder.identity).toEqual(guest("g1"));
    expect(second.match.matchId).toBeTruthy();
  });

  it("never matches a user with themselves across duplicate joins", async () => {
    const { service, queue } = buildService();

    expect((await service.join(guest("g1"), "s1")).status).toBe("queued");
    // Same identity joins again (e.g. a second tab) — stays queued, no self-match.
    expect((await service.join(guest("g1"), "s2")).status).toBe("queued");
    expect(await queue.size()).toBe(1);
  });

  it("does not rematch two identities under a rematch-prevention block (issue #27, stories 53-54)", async () => {
    const { service, rematchGuard, queue } = buildService();
    // g1 reported/blocked u1 in a prior match, so the two are kept apart.
    await rematchGuard.preventRematch("guest:g1", "user:u1");

    // g1 is waiting; u1 joins. The only waiter is excluded, so u1 stays queued
    // rather than being paired straight back with the person they just left.
    expect((await service.join(guest("g1"), "s1")).status).toBe("queued");
    expect((await service.join(user("u1"), "s2")).status).toBe("queued");
    expect(await queue.size()).toBe(2);

    // A third, unrelated user pairs with the oldest waiter (g1) normally — the
    // block only excludes the specific pair, not matching in general.
    const third = await service.join(guest("g2"), "s3");
    expect(third.status).toBe("matched");
    if (third.status !== "matched") throw new Error("expected a match");
    expect(third.match.responder.identity).toEqual(guest("g1"));
  });

  it("matches the blocked pair again once the prevention window lapses (story 54)", async () => {
    const { service, rematchGuard } = buildService();
    const t0 = new Date("2026-06-28T00:00:00.000Z");
    await rematchGuard.preventRematch("guest:g1", "user:u1", t0);

    await service.join(guest("g1"), "s1", {}, t0);
    // Well past productConfig.rematchPreventionSeconds — the exclusion has lapsed.
    const later = new Date(t0.getTime() + 2_000 * 1000);
    const rejoin = await service.join(user("u1"), "s2", {}, later);
    expect(rejoin.status).toBe("matched");
  });

  it("rejects joins when the queue_entry kill switch is off (story 84)", async () => {
    const { service } = buildService(["queue_entry"]);
    expect((await service.join(guest("g1"), "s1")).status).toBe("unavailable");
  });

  it("re-opens joins immediately after the kill switch is turned back on", async () => {
    const { service, flags } = buildService(["queue_entry"]);
    expect((await service.join(guest("g1"), "s1")).status).toBe("unavailable");

    await flags.setEnabled("queue_entry", true, "admin");
    expect((await service.join(guest("g1"), "s1")).status).toBe("queued");
  });

  it("lets a waiting user leave the pool before matching", async () => {
    const { service, queue } = buildService();
    await service.join(guest("g1"), "s1");

    expect(await service.leave(guest("g1"))).toBe(true);
    expect(await queue.size()).toBe(0);
    // A second leave is a no-op.
    expect(await service.leave(guest("g1"))).toBe(false);
  });

  it("frees a disconnected socket's slot without a deliberate leave", async () => {
    const { service, queue } = buildService();
    await service.join(guest("g1"), "sock-1");

    await service.handleDisconnect("sock-1");
    expect(await queue.size()).toBe(0);
  });

  it("reports operator queue-health metrics (story 38)", async () => {
    const { service, flags } = buildService(["queue_entry"]);
    // One rejected join while closed.
    await service.join(guest("g1"), "s1");

    await flags.setEnabled("queue_entry", true, "admin");
    await service.join(guest("g1"), "s1"); // queued
    await service.join(user("u1"), "s2"); // matched with g1
    await service.join(guest("g2"), "s3"); // queued
    await service.leave(guest("g2")); // left

    const metrics = await service.metrics();
    expect(metrics).toEqual({
      waiting: 0,
      totalJoins: 3,
      totalMatches: 1,
      totalLanguageMatches: 1, // g1 and u1 both default to "en"
      totalRelaxedMatches: 0,
      totalGenderFilteredMatches: 0, // no filter was in play
      totalGenderRelaxedMatches: 0,
      totalLeaves: 1,
      totalRejectedUnavailable: 1,
      totalRateLimited: 0,
    });
  });

  it("throttles a guest hammering join past their queue-join limit (stories 142-144)", async () => {
    const { service } = buildService();
    const t0 = new Date("2026-06-26T00:00:00.000Z");

    // A guest's queue-join limit is 10 per 60s (stricter than a user's 20). The
    // first 10 attempts are accepted (queued/idempotent), the 11th is throttled.
    for (let i = 0; i < 10; i += 1) {
      const ok = await service.join(guest("spammer"), `s${i}`, {}, t0);
      expect(ok.status).toBe("queued");
    }
    const throttled = await service.join(guest("spammer"), "s10", {}, t0);
    expect(throttled.status).toBe("rate_limited");
    if (throttled.status !== "rate_limited") throw new Error("expected throttle");
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    expect((await service.metrics()).totalRateLimited).toBe(1);
  });

  it("gives logged-in users a higher join ceiling than guests (story 143)", async () => {
    const { service } = buildService();
    const t0 = new Date("2026-06-26T00:00:00.000Z");

    // A logged-in user is still capped (login is no bypass) but at 20, not 10 —
    // so where a guest would already be throttled, the user's 11th join is fine.
    for (let i = 0; i < 11; i += 1) {
      const result = await service.join(user("heavy"), `s${i}`, {}, t0);
      expect(result.status).toBe("queued");
    }
  });

  it("recovers the join budget after the window elapses", async () => {
    const { service } = buildService();
    const t0 = new Date("2026-06-26T00:00:00.000Z");
    const later = new Date(t0.getTime() + 61 * 1000);

    for (let i = 0; i < 10; i += 1) {
      await service.join(guest("g1"), `s${i}`, {}, t0);
    }
    expect((await service.join(guest("g1"), "s10", {}, t0)).status).toBe(
      "rate_limited"
    );
    // A full window later the counter has reset and the guest can join again.
    expect((await service.join(guest("g1"), "s11", {}, later)).status).toBe(
      "queued"
    );
  });
});

describe("MatchmakingService staged language relaxation (story 36)", () => {
  const en = "en" as const;
  const es = "es" as const;
  /** Far enough past the relax window (15s) that a waiter is cross-language eligible. */
  const past = (base: Date) =>
    new Date(base.getTime() + 16 * 1000);

  it("prefers a same-language partner over an older different-language waiter", async () => {
    const { service } = buildService();
    const t0 = new Date("2026-06-26T00:00:00.000Z");

    // An older Spanish speaker, then a newer English speaker, both waiting.
    expect((await service.join(guest("es1"), "s1", { language: es }, t0)).status).toBe("queued");
    expect((await service.join(guest("en1"), "s2", { language: en }, t0)).status).toBe("queued");

    // An English joiner pairs with the English speaker, not the older Spanish one.
    const result = await service.join(user("en2"), "s3", { language: en }, t0);
    expect(result.status).toBe("matched");
    if (result.status !== "matched") throw new Error("expected a match");
    expect(result.match.responder.identity).toEqual(guest("en1"));

    // The Spanish speaker is still waiting and the match counted as a language match.
    const metrics = await service.metrics();
    expect(metrics.waiting).toBe(1);
    expect(metrics.totalLanguageMatches).toBe(1);
    expect(metrics.totalRelaxedMatches).toBe(0);
  });

  it("queues rather than matching a different-language partner inside the window", async () => {
    const { service } = buildService();
    const t0 = new Date("2026-06-26T00:00:00.000Z");

    expect((await service.join(guest("es1"), "s1", { language: es }, t0)).status).toBe("queued");
    // English joiner arrives immediately: no same-language partner, Spanish one
    // hasn't relaxed yet → the joiner waits instead of cross-matching.
    expect((await service.join(guest("en1"), "s2", { language: en }, t0)).status).toBe("queued");
    expect((await service.metrics()).waiting).toBe(2);
  });

  it("relaxes across languages once the waiter passes the relax window", async () => {
    const { service } = buildService();
    const t0 = new Date("2026-06-26T00:00:00.000Z");

    expect((await service.join(guest("es1"), "s1", { language: es }, t0)).status).toBe("queued");

    // Later, an English joiner arrives after the Spanish speaker's window lapses.
    const result = await service.join(user("en1"), "s2", { language: en }, past(t0));
    expect(result.status).toBe("matched");
    if (result.status !== "matched") throw new Error("expected a match");
    expect(result.match.responder.identity).toEqual(guest("es1"));

    const metrics = await service.metrics();
    expect(metrics.totalRelaxedMatches).toBe(1);
    expect(metrics.totalLanguageMatches).toBe(0);
  });
});

describe("MatchmakingService gender-filtered matching (stories 31-33, 35)", () => {
  const t0 = new Date("2026-06-26T00:00:00.000Z");
  /** Past the 20s gender window so a waiter is fall-back eligible. */
  const pastGender = (base: Date) => new Date(base.getTime() + 21 * 1000);

  it("matches a filtered joiner with a declared user of that gender (story 32)", async () => {
    const { service } = buildService();

    // A declared female user waits; a male joiner filtering for women pairs with
    // her at once and the match counts as a fully-honored gender match.
    expect(
      (await service.join(user("f1"), "s1", { gender: "female" }, t0)).status
    ).toBe("queued");
    const result = await service.join(
      user("m1"),
      "s2",
      { gender: "male", genderFilter: "female" },
      t0
    );
    expect(result.status).toBe("matched");
    if (result.status !== "matched") throw new Error("expected a match");
    expect(result.match.responder.identity).toEqual(user("f1"));

    const metrics = await service.metrics();
    expect(metrics.totalGenderFilteredMatches).toBe(1);
    expect(metrics.totalGenderRelaxedMatches).toBe(0);
  });

  it("holds a filtered joiner rather than matching a guest inside the window (story 33)", async () => {
    const { service } = buildService();

    // Only a guest (gender unknown) is waiting; a female-filtering joiner won't
    // settle for them yet, so both end up waiting.
    expect((await service.join(guest("g1"), "s1", {}, t0)).status).toBe("queued");
    expect(
      (await service.join(user("m1"), "s2", { gender: "male", genderFilter: "female" }, t0)).status
    ).toBe("queued");
    expect((await service.metrics()).waiting).toBe(2);
  });

  it("falls back to a guest after the visible wait window (stories 33, 35)", async () => {
    const { service } = buildService();

    // A male user filtering for women waits; no women arrive.
    expect(
      (await service.join(user("m1"), "s1", { gender: "male", genderFilter: "female" }, t0)).status
    ).toBe("queued");

    // Past his window, a guest joins and now pairs with him — the strong gender
    // preference relaxed to a guest fall-back, recorded as a relaxed match.
    const result = await service.join(guest("g1"), "s2", {}, pastGender(t0));
    expect(result.status).toBe("matched");
    if (result.status !== "matched") throw new Error("expected a match");
    expect(result.match.responder.identity).toEqual(user("m1"));

    const metrics = await service.metrics();
    expect(metrics.totalGenderFilteredMatches).toBe(0);
    expect(metrics.totalGenderRelaxedMatches).toBe(1);
  });

  it("ignores gender filters when the gender_filters kill switch is off (story 84)", async () => {
    const { service } = buildService(["gender_filters"]);

    // A male user filtering for women is waiting; with filtering disabled a guest
    // joins and matches immediately, and no gender health counter moves.
    expect(
      (await service.join(user("m1"), "s1", { gender: "male", genderFilter: "female" }, t0)).status
    ).toBe("queued");
    const result = await service.join(guest("g1"), "s2", {}, t0);
    expect(result.status).toBe("matched");

    const metrics = await service.metrics();
    expect(metrics.totalGenderFilteredMatches).toBe(0);
    expect(metrics.totalGenderRelaxedMatches).toBe(0);
  });
});
