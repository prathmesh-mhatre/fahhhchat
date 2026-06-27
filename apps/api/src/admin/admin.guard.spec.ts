import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { USER_COOKIE_NAME } from "../auth/auth.types";
import { AuthService } from "../auth/auth.service";
import { InMemoryUserStore } from "../auth/in-memory-user.store";
import { DevMockTokenVerifier, encodeMockGoogleToken } from "../auth/google-token-verifier";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { InMemoryFeatureFlagStore } from "../feature-flags/in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "../feature-flags/in-memory-feature-flag-audit.log";
import { AdminGuard, type RequestWithAdmin } from "./admin.guard";
import { AdminService } from "./admin.service";
import { InMemoryAdminStore } from "./in-memory-admin.store";

function buildAuth(): AuthService {
  return new AuthService(
    new InMemoryUserStore(),
    new DevMockTokenVerifier(),
    new FeatureFlagsService(new InMemoryFeatureFlagStore(), new InMemoryFeatureFlagAuditLog())
  );
}

async function loginToken(auth: AuthService, sub: string, email: string): Promise<string> {
  const { token } = await auth.loginWithGoogle(encodeMockGoogleToken({ sub, email }));
  return token;
}

/** An ExecutionContext that exposes a request carrying the given fc_user cookie. */
function contextFor(token: string | undefined): { context: ExecutionContext; request: RequestWithAdmin } {
  const request = {
    cookies: token === undefined ? {} : { [USER_COOKIE_NAME]: token }
  } as unknown as RequestWithAdmin;
  const context = {
    switchToHttp: () => ({ getRequest: () => request as Request })
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("AdminGuard (story 82)", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  async function buildGuard(allowlist: string[], auth: AuthService) {
    const service = new AdminService(new InMemoryAdminStore(), allowlist, auth);
    await service.seedAllowlist();
    return new AdminGuard(service);
  }

  it("allows an allowlisted admin through and attaches the admin context", async () => {
    const auth = buildAuth();
    const guard = await buildGuard(["admin@example.com"], auth);
    const token = await loginToken(auth, "google-admin", "admin@example.com");
    const { context, request } = contextFor(token);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.admin).toMatchObject({ role: "admin" });
  });

  it("rejects a normal authenticated Google user with 403", async () => {
    const auth = buildAuth();
    const guard = await buildGuard(["admin@example.com"], auth);
    const token = await loginToken(auth, "google-bob", "bob@example.com");
    const { context } = contextFor(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects an anonymous request with 403", async () => {
    const auth = buildAuth();
    const guard = await buildGuard(["admin@example.com"], auth);
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
