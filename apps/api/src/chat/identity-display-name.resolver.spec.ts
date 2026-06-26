import type { AuthService } from "../auth/auth.service";
import type { GuestSessionService } from "../session/guest-session.service";
import { IdentityDisplayNameResolver } from "./identity-display-name.resolver";

/**
 * The resolver is pure delegation: a logged-in identity resolves through the
 * auth store, a guest identity through the session store. These fakes record
 * which side was asked and with what id, so the routing is the only thing under
 * test (the name lookups themselves are covered by the auth/session specs).
 */
function buildResolver() {
  const calls: { auth: string[]; guest: string[] } = { auth: [], guest: [] };
  const auth = {
    async getDisplayName(userId: string) {
      calls.auth.push(userId);
      return userId === "u1" ? "Mellow Otter" : null;
    },
  } as unknown as AuthService;
  const guest = {
    async getDisplayNameBySessionId(sessionId: string) {
      calls.guest.push(sessionId);
      return sessionId === "g1" ? "Cosmic Sparrow" : null;
    },
  } as unknown as GuestSessionService;
  return { resolver: new IdentityDisplayNameResolver(auth, guest), calls };
}

describe("IdentityDisplayNameResolver", () => {
  it("resolves a logged-in identity through the auth store only", async () => {
    const { resolver, calls } = buildResolver();

    const name = await resolver.resolve({ kind: "user", id: "u1" });

    expect(name).toBe("Mellow Otter");
    expect(calls.auth).toEqual(["u1"]);
    expect(calls.guest).toEqual([]);
  });

  it("resolves a guest identity through the session store only", async () => {
    const { resolver, calls } = buildResolver();

    const name = await resolver.resolve({ kind: "guest", id: "g1" });

    expect(name).toBe("Cosmic Sparrow");
    expect(calls.guest).toEqual(["g1"]);
    expect(calls.auth).toEqual([]);
  });

  it("passes through a null name when the identity can no longer be resolved", async () => {
    const { resolver } = buildResolver();

    expect(await resolver.resolve({ kind: "user", id: "gone" })).toBeNull();
    expect(await resolver.resolve({ kind: "guest", id: "gone" })).toBeNull();
  });
});
