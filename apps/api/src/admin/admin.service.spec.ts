import { AuthService } from "../auth/auth.service";
import { InMemoryUserStore } from "../auth/in-memory-user.store";
import { DevMockTokenVerifier, encodeMockGoogleToken } from "../auth/google-token-verifier";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";
import { AdminService } from "./admin.service";
import { InMemoryAdminStore } from "./in-memory-admin.store";

/** A real AuthService over in-memory stores so we can mint genuine app tokens. */
function buildAuth(): AuthService {
  return new AuthService(
    new InMemoryUserStore(),
    new DevMockTokenVerifier(),
    new FeatureFlagsService(new InMemoryFeatureFlagStore(), new InMemoryFeatureFlagAuditLog())
  );
}

/** Log a Google identity in and return the app session token the backend mints. */
async function loginToken(auth: AuthService, sub: string, email: string): Promise<string> {
  const { token } = await auth.loginWithGoogle(encodeMockGoogleToken({ sub, email }));
  return token;
}

function buildAdmin(allowlist: string[], auth: AuthService) {
  const store = new InMemoryAdminStore();
  const service = new AdminService(store, allowlist, auth);
  return { service, store };
}

describe("AdminService", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  describe("allowlist seeding (story 83)", () => {
    it("seeds each allowlisted email as an admin on init", async () => {
      const auth = buildAuth();
      const { service, store } = buildAdmin(["founder@example.com"], auth);

      await service.onModuleInit();

      const record = await store.findByEmail("founder@example.com");
      expect(record).toMatchObject({
        email: "founder@example.com",
        role: "admin",
        source: "allowlist"
      });
    });

    it("is idempotent — re-seeding creates no duplicate grant", async () => {
      const auth = buildAuth();
      const { service, store } = buildAdmin(["founder@example.com"], auth);

      await service.seedAllowlist();
      const created = await service.seedAllowlist();

      expect(created).toHaveLength(0);
      expect(await store.list()).toHaveLength(1);
    });

    it("matches allowlist emails case-insensitively", async () => {
      const auth = buildAuth();
      const { service } = buildAdmin(["Founder@Example.com"], auth);

      await service.seedAllowlist();

      // The allowlist token is normalized to lower-case by parseAdminAllowlist in
      // the module; the service stores whatever it is given but looks up
      // case-insensitively, so a differently-cased login still resolves.
      expect(await service.isAdminEmail("FOUNDER@example.COM")).toBe(true);
    });

    it("grants no admin when the allowlist is empty", async () => {
      const auth = buildAuth();
      const { service, store } = buildAdmin([], auth);

      await service.seedAllowlist();

      expect(await store.list()).toHaveLength(0);
    });
  });

  describe("role checks (story 82)", () => {
    it("resolves an admin context for an allowlisted, logged-in Google user", async () => {
      const auth = buildAuth();
      const { service } = buildAdmin(["admin@example.com"], auth);
      await service.seedAllowlist();

      const token = await loginToken(auth, "google-admin", "admin@example.com");

      await expect(service.resolveAdmin(token)).resolves.toMatchObject({ role: "admin" });
    });

    it("rejects a logged-in Google user who is not on the allowlist", async () => {
      const auth = buildAuth();
      const { service } = buildAdmin(["admin@example.com"], auth);
      await service.seedAllowlist();

      const token = await loginToken(auth, "google-bob", "bob@example.com");

      await expect(service.resolveAdmin(token)).resolves.toBeNull();
    });

    it("rejects an anonymous request (no valid session token)", async () => {
      const auth = buildAuth();
      const { service } = buildAdmin(["admin@example.com"], auth);
      await service.seedAllowlist();

      await expect(service.resolveAdmin(undefined)).resolves.toBeNull();
      await expect(service.resolveAdmin("not-a-real-token")).resolves.toBeNull();
    });

    it("matches the session email to the grant case-insensitively", async () => {
      const auth = buildAuth();
      const { service } = buildAdmin(["admin@example.com"], auth);
      await service.seedAllowlist();

      // Same Google account, email reported with different casing.
      const token = await loginToken(auth, "google-admin", "Admin@Example.com");

      await expect(service.resolveAdmin(token)).resolves.toMatchObject({ role: "admin" });
    });
  });
});
