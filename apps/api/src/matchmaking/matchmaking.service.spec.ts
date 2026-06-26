import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";
import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import { MatchmakingService } from "./matchmaking.service";
import type { RealtimeIdentity } from "../realtime/realtime.types";

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

/** Build the service over real (in-memory) collaborators; queue_entry starts on. */
function buildService(disabled: Array<"queue_entry"> = []) {
  const flags = new FeatureFlagsService(
    new InMemoryFeatureFlagStore(disabled),
    new InMemoryFeatureFlagAuditLog()
  );
  const queue = new InMemoryMatchmakingQueue();
  return { service: new MatchmakingService(queue, flags), queue, flags };
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
      totalLeaves: 1,
      totalRejectedUnavailable: 1,
    });
  });
});
