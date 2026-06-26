import type { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service";
import { InMemoryUserStore } from "../auth/in-memory-user.store";
import { DevMockTokenVerifier } from "../auth/google-token-verifier";
import { ChatService } from "../chat/chat.service";
import { InMemoryChatStore } from "../chat/in-memory-chat.store";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory-rate-limit.store";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { InMemoryMatchmakingQueue } from "./in-memory-matchmaking.queue";
import { MatchmakingGateway } from "./matchmaking.gateway";
import { MatchmakingService } from "./matchmaking.service";
import { MATCHMAKING_EVENTS } from "./matchmaking.types";
import type { RealtimeIdentity } from "../realtime/realtime.types";

interface Emit {
  event: string;
  payload: unknown;
}

/** Fake socket carrying a (possibly absent) authenticated identity. */
function fakeSocket(id: string, identity?: RealtimeIdentity) {
  const emitted: Emit[] = [];
  const socket = {
    id,
    data: { identity },
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return true;
    },
  } as unknown as Socket;
  return { socket, emitted };
}

/**
 * Fake Socket.IO server that records `server.to(socketId).emit(...)` so the test
 * can assert which socket each match notification was delivered to.
 */
function fakeServer() {
  const delivered: Array<{ to: string } & Emit> = [];
  const server = {
    to(socketId: string) {
      return {
        emit(event: string, payload: unknown) {
          delivered.push({ to: socketId, event, payload });
          return true;
        },
      };
    },
  } as unknown as Server;
  return { server, delivered };
}

function buildGateway(disabled: Array<"queue_entry" | "gender_filters"> = []) {
  const flags = new FeatureFlagsService(
    new InMemoryFeatureFlagStore(disabled),
    new InMemoryFeatureFlagAuditLog()
  );
  const rateLimits = new RateLimitService(new InMemoryRateLimitStore());
  const service = new MatchmakingService(
    new InMemoryMatchmakingQueue(),
    flags,
    rateLimits
  );
  // The gateway reads a logged-in joiner's declared gender + filter off the
  // account, so it needs a real AuthService over an (seedable) in-memory store.
  const store = new InMemoryUserStore();
  const auth = new AuthService(store, new DevMockTokenVerifier(), flags);
  // The gateway registers each new pair with the chat layer; a real ChatService
  // over an in-memory store lets the test assert the active match was created.
  const chat = new ChatService(new InMemoryChatStore());
  const gateway = new MatchmakingGateway(service, auth, chat);
  const { server, delivered } = fakeServer();
  (gateway as unknown as { server: Server }).server = server;
  return { gateway, delivered, service, store, chat };
}

/** Seed a logged-in account with declared gender + filter for the gateway to read. */
async function seedUser(
  store: InMemoryUserStore,
  userId: string,
  gender: "male" | "female",
  genderFilter: "male" | "female" | "both"
): Promise<void> {
  const now = new Date().toISOString();
  await store.save({
    userId,
    googleSub: `sub-${userId}`,
    email: `${userId}@example.test`,
    createdAt: now,
    lastLoginAt: now,
    gender,
    genderFilter,
  });
}

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

describe("MatchmakingGateway", () => {
  beforeAll(() => {
    // AuthService signs tokens on construction; matching never mints one here,
    // but the constructor still requires the secret to be present.
    process.env.AUTH_SECRET = "test-secret";
  });
  it("refuses a join from a socket with no authenticated identity", async () => {
    const { gateway } = buildGateway();
    const { socket, emitted } = fakeSocket("s1"); // no identity

    await gateway.handleJoin(socket);

    expect(emitted).toContainEqual({
      event: MATCHMAKING_EVENTS.error,
      payload: { message: "Not authenticated for realtime." },
    });
  });

  it("tells the first joiner they are waiting", async () => {
    const { gateway } = buildGateway();
    const { socket, emitted } = fakeSocket("s1", guest("g1"));

    await gateway.handleJoin(socket);

    expect(emitted).toContainEqual({
      event: MATCHMAKING_EVENTS.waiting,
      payload: {},
    });
  });

  it("notifies both sockets with the same matchId and distinct roles", async () => {
    const { gateway, delivered } = buildGateway();
    const a = fakeSocket("s1", guest("g1"));
    const b = fakeSocket("s2", user("u1"));

    await gateway.handleJoin(a.socket); // queued
    await gateway.handleJoin(b.socket); // matches g1

    const found = delivered.filter(
      (d) => d.event === MATCHMAKING_EVENTS.matchFound
    );
    expect(found).toHaveLength(2);

    const byTarget = Object.fromEntries(found.map((d) => [d.to, d.payload]));
    const initiator = byTarget["s2"] as { matchId: string; role: string };
    const responder = byTarget["s1"] as { matchId: string; role: string };
    expect(initiator.role).toBe("initiator"); // the joiner who triggered the pair
    expect(responder.role).toBe("responder"); // the one who was waiting
    expect(initiator.matchId).toBe(responder.matchId);
  });

  it("registers the active match with the chat layer so messages can route (issue #21)", async () => {
    const { gateway, chat } = buildGateway();
    const a = fakeSocket("s1", guest("g1"));
    const b = fakeSocket("s2", user("u1"));

    await gateway.handleJoin(a.socket); // queued
    await gateway.handleJoin(b.socket); // matches g1

    // Both sides resolve to the same active match the instant they are paired.
    const forGuest = await chat.activeMatchFor(guest("g1"));
    const forUser = await chat.activeMatchFor(user("u1"));
    expect(forGuest).not.toBeNull();
    expect(forUser?.matchId).toBe(forGuest?.matchId);
  });

  it("passes the join payload's language through to matching (story 36)", async () => {
    const { gateway, delivered, service } = buildGateway();
    const es = fakeSocket("s1", guest("g1"));
    const en = fakeSocket("s2", user("u1"));
    const es2 = fakeSocket("s3", guest("g2"));

    // A Spanish and an English speaker arrive: no same-language partner for
    // either and neither has relaxed yet, so both wait.
    await gateway.handleJoin(es.socket, { language: "es" });
    await gateway.handleJoin(en.socket, { language: "en" });
    expect((await service.metrics()).waiting).toBe(2);

    // A second Spanish speaker pairs with the first, leaving the English one.
    await gateway.handleJoin(es2.socket, { language: "es" });
    const found = delivered.filter(
      (d) => d.event === MATCHMAKING_EVENTS.matchFound
    );
    expect(found.map((d) => d.to).sort()).toEqual(["s1", "s3"]);
    expect((await service.metrics()).totalLanguageMatches).toBe(1);
  });

  it("emits an error when queue entry is killed (story 84)", async () => {
    const { gateway } = buildGateway(["queue_entry"]);
    const { socket, emitted } = fakeSocket("s1", guest("g1"));

    await gateway.handleJoin(socket);

    expect(emitted.map((e) => e.event)).toContain(MATCHMAKING_EVENTS.error);
  });

  it("emits a rate-limited event with a retry hint once a guest floods join (stories 142-144)", async () => {
    const { gateway } = buildGateway();
    const { socket, emitted } = fakeSocket("s1", guest("g1"));

    // A guest's join limit is 10/min; the 11th attempt from the same identity is
    // throttled and the client is told how long to wait rather than left hanging.
    for (let i = 0; i < 11; i += 1) {
      await gateway.handleJoin(socket);
    }

    const limited = emitted.filter(
      (e) => e.event === MATCHMAKING_EVENTS.rateLimited
    );
    expect(limited).toHaveLength(1);
    expect(
      (limited[0].payload as { retryAfterSeconds: number }).retryAfterSeconds
    ).toBeGreaterThan(0);
  });

  it("acknowledges a leave and clears the queue slot", async () => {
    const { gateway, service } = buildGateway();
    const { socket, emitted } = fakeSocket("s1", guest("g1"));

    await gateway.handleJoin(socket);
    await gateway.handleLeave(socket);

    expect(emitted).toContainEqual({
      event: MATCHMAKING_EVENTS.left,
      payload: {},
    });
    expect((await service.metrics()).waiting).toBe(0);
  });

  it("frees the queue slot on disconnect", async () => {
    const { gateway, service } = buildGateway();
    const { socket } = fakeSocket("sock-1", guest("g1"));

    await gateway.handleJoin(socket);
    await gateway.handleDisconnect(socket);

    expect((await service.metrics()).waiting).toBe(0);
  });

  it("applies a logged-in joiner's stored gender filter to matching (stories 30-32)", async () => {
    const { gateway, delivered, service, store } = buildGateway();
    // u1 declares male and filters for women; u3 is male, u2 female.
    await seedUser(store, "u1", "male", "female");
    await seedUser(store, "u3", "male", "both");
    await seedUser(store, "u2", "female", "both");
    const filtering = fakeSocket("s1", user("u1"));
    const male = fakeSocket("s3", user("u3"));
    const female = fakeSocket("s2", user("u2"));

    // u1 waits, then a male user joins: u1's stored female filter rejects him, so
    // both wait rather than pairing — the filter is read off the account.
    await gateway.handleJoin(filtering.socket);
    await gateway.handleJoin(male.socket);
    expect((await service.metrics()).waiting).toBe(2);

    // A declared female user then pairs with u1, honoring the stored filter, and
    // the male is left waiting.
    await gateway.handleJoin(female.socket);
    const found = delivered.filter(
      (d) => d.event === MATCHMAKING_EVENTS.matchFound
    );
    expect(found.map((d) => d.to).sort()).toEqual(["s1", "s2"]);
    expect((await service.metrics()).totalGenderFilteredMatches).toBe(1);
    expect((await service.metrics()).waiting).toBe(1);
  });

  it("treats guests as carrying no gender filter", async () => {
    const { gateway, delivered } = buildGateway();
    const a = fakeSocket("s1", guest("g1"));
    const b = fakeSocket("s2", guest("g2"));

    // Two guests pair immediately — guests declare no gender and no filter.
    await gateway.handleJoin(a.socket);
    await gateway.handleJoin(b.socket);

    const found = delivered.filter(
      (d) => d.event === MATCHMAKING_EVENTS.matchFound
    );
    expect(found).toHaveLength(2);
  });
});
