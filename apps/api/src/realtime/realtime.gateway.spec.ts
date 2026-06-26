import type { Socket } from "socket.io";
import {
  RealtimeGateway,
  type AuthenticatedSocketData,
} from "./realtime.gateway";
import { RealtimeTokenService } from "./realtime-token.service";
import type { RealtimeIdentity } from "./realtime.types";

/** Minimal stand-in for a Socket.IO socket that records gateway interactions. */
function fakeSocket(handshake: Partial<Socket["handshake"]>): {
  socket: Socket;
  emitted: Array<{ event: string; payload: unknown }>;
  disconnected: boolean;
} {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const state = { disconnected: false };
  const socket = {
    handshake: { auth: {}, headers: {}, ...handshake },
    data: {},
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return true;
    },
    disconnect() {
      state.disconnected = true;
      return this;
    },
  } as unknown as Socket;
  return {
    socket,
    emitted,
    get disconnected() {
      return state.disconnected;
    },
  };
}

describe("RealtimeGateway", () => {
  let tokens: RealtimeTokenService;
  let gateway: RealtimeGateway;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  beforeEach(() => {
    tokens = new RealtimeTokenService();
    gateway = new RealtimeGateway(tokens);
  });

  const identity: RealtimeIdentity = { kind: "user", id: "user-abc" };

  it("attaches the identity for a valid handshake token in the auth payload", () => {
    const { token } = tokens.issue(identity);
    const conn = fakeSocket({ auth: { token } });

    gateway.handleConnection(conn.socket);

    expect(conn.disconnected).toBe(false);
    expect((conn.socket.data as AuthenticatedSocketData).identity).toEqual(
      identity,
    );
    expect(conn.emitted).toContainEqual({
      event: "authenticated",
      payload: { identity },
    });
  });

  it("accepts a token passed as an Authorization: Bearer header", () => {
    const { token } = tokens.issue(identity);
    const conn = fakeSocket({ headers: { authorization: `Bearer ${token}` } });

    gateway.handleConnection(conn.socket);

    expect(conn.disconnected).toBe(false);
    expect((conn.socket.data as AuthenticatedSocketData).identity).toEqual(
      identity,
    );
  });

  it("disconnects a connection with no token", () => {
    const conn = fakeSocket({ auth: {} });

    gateway.handleConnection(conn.socket);

    expect(conn.disconnected).toBe(true);
    expect(
      (conn.socket.data as AuthenticatedSocketData).identity,
    ).toBeUndefined();
    expect(conn.emitted).toContainEqual({
      event: "auth_error",
      payload: { message: "Invalid or expired realtime token." },
    });
  });

  it("disconnects a connection with a tampered token", () => {
    const { token } = tokens.issue(identity);
    const conn = fakeSocket({ auth: { token: `${token}tampered` } });

    gateway.handleConnection(conn.socket);

    expect(conn.disconnected).toBe(true);
    expect(conn.emitted).toContainEqual({
      event: "auth_error",
      payload: { message: "Invalid or expired realtime token." },
    });
  });
});
