import type { Server, Socket } from "socket.io";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";
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

function buildGateway(disabled: Array<"queue_entry"> = []) {
  const flags = new FeatureFlagsService(
    new InMemoryFeatureFlagStore(disabled),
    new InMemoryFeatureFlagAuditLog()
  );
  const service = new MatchmakingService(new InMemoryMatchmakingQueue(), flags);
  const gateway = new MatchmakingGateway(service);
  const { server, delivered } = fakeServer();
  (gateway as unknown as { server: Server }).server = server;
  return { gateway, delivered, service };
}

const guest = (id: string): RealtimeIdentity => ({ kind: "guest", id });
const user = (id: string): RealtimeIdentity => ({ kind: "user", id });

describe("MatchmakingGateway", () => {
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
});
