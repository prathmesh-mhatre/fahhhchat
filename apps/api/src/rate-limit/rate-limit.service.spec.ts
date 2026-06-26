import { rateLimits } from "@fahhhchat/config";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import { InMemoryRateLimitStore } from "./in-memory-rate-limit.store";
import { RateLimitService } from "./rate-limit.service";

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

function build() {
  return new RateLimitService(new InMemoryRateLimitStore());
}

describe("RateLimitService (stories 140-144)", () => {
  const t0 = new Date("2026-06-26T00:00:00.000Z");

  it("allows attempts up to the limit and throttles the next one", async () => {
    const service = build();
    const limit = rateLimits.queue_join.guest.limit;

    for (let i = 0; i < limit; i += 1) {
      const decision = await service.consume("queue_join", guest("g1"), t0);
      expect(decision.allowed).toBe(true);
    }
    // The attempt that tips over the limit is the first one refused.
    const over = await service.consume("queue_join", guest("g1"), t0);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("gives guests a stricter limit than logged-in users (stories 142-143)", async () => {
    // The contract the abuse model rests on: every action's guest limit is lower
    // than its user limit, so login is never an abuse bypass but is also capped.
    for (const action of ["queue_join", "reconnect"] as const) {
      expect(rateLimits[action].guest.limit).toBeLessThan(
        rateLimits[action].user.limit
      );
    }

    const service = build();
    const guestLimit = rateLimits.reconnect.guest.limit;
    for (let i = 0; i < guestLimit; i += 1) {
      expect((await service.consume("reconnect", guest("g1"), t0)).allowed).toBe(
        true
      );
    }
    expect((await service.consume("reconnect", guest("g1"), t0)).allowed).toBe(
      false
    );

    // A logged-in user, having made the same number of attempts, is still under
    // their higher ceiling.
    for (let i = 0; i < guestLimit; i += 1) {
      expect((await service.consume("reconnect", user("u1"), t0)).allowed).toBe(
        true
      );
    }
    expect((await service.consume("reconnect", user("u1"), t0)).allowed).toBe(
      true
    );
  });

  it("scopes counters by action, tier, and identity independently", async () => {
    const service = build();
    const limit = rateLimits.queue_join.guest.limit;

    // Exhaust one guest's queue-join budget.
    for (let i = 0; i <= limit; i += 1) {
      await service.consume("queue_join", guest("g1"), t0);
    }
    expect((await service.consume("queue_join", guest("g1"), t0)).allowed).toBe(
      false
    );

    // A different guest is unaffected (per-identity)...
    expect((await service.consume("queue_join", guest("g2"), t0)).allowed).toBe(
      true
    );
    // ...the same guest's reconnect budget is untouched (per-action)...
    expect((await service.consume("reconnect", guest("g1"), t0)).allowed).toBe(
      true
    );
    // ...and a user that happens to share the id "g1" never collides (per-tier).
    expect((await service.consume("queue_join", user("g1"), t0)).allowed).toBe(
      true
    );
  });

  it("resets the window after it elapses and reports an honest retry hint", async () => {
    const service = build();
    const limit = rateLimits.queue_join.guest.limit;
    const windowSeconds = rateLimits.queue_join.guest.windowSeconds;

    for (let i = 0; i < limit; i += 1) {
      await service.consume("queue_join", guest("g1"), t0);
    }
    const throttled = await service.consume("queue_join", guest("g1"), t0);
    expect(throttled.allowed).toBe(false);
    // Retry hint never exceeds the window length and rounds up to whole seconds.
    expect(throttled.retryAfterSeconds).toBeLessThanOrEqual(windowSeconds);

    const later = new Date(t0.getTime() + (windowSeconds + 1) * 1000);
    const after = await service.consume("queue_join", guest("g1"), later);
    expect(after.allowed).toBe(true);
    expect(after.retryAfterSeconds).toBe(0);
  });
});
