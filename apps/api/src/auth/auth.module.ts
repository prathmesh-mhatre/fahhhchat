import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { GOOGLE_TOKEN_VERIFIER, USER_STORE, type UserStore } from "./auth.types";
import {
  DevMockTokenVerifier,
  GoogleJwksVerifier,
  type GoogleTokenVerifier
} from "./google-token-verifier";
import { InMemoryUserStore } from "./in-memory-user.store";

/**
 * Selects the Google token verifier from the environment: the real JWKS
 * verifier when a Google client id is configured, otherwise the dev-mock
 * verifier so login stays demoable/testable without real OAuth credentials
 * (set `AUTH_DEV_MODE=true` in local dev).
 */
function createGoogleVerifier(): GoogleTokenVerifier {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (clientId && process.env.AUTH_DEV_MODE !== "true") {
    return new GoogleJwksVerifier(clientId);
  }
  return new DevMockTokenVerifier();
}

/**
 * Durable user records belong in Postgres per the PRD; until that store lands,
 * an in-memory implementation keeps the login slice demoable and unit-testable.
 */
function createUserStore(): UserStore {
  return new InMemoryUserStore();
}

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    { provide: USER_STORE, useFactory: createUserStore },
    { provide: GOOGLE_TOKEN_VERIFIER, useFactory: createGoogleVerifier }
  ],
  exports: [AuthService]
})
export class AuthModule {}
