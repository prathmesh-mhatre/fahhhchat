import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { rateLimits } from "@fahhhchat/config";
import { USER_COOKIE_NAME } from "../auth/auth.types";
import { GUEST_COOKIE_NAME } from "../session/session.types";
import { InMemoryRateLimitStore } from "../rate-limit/in-memory-rate-limit.store";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { RealtimeController } from "./realtime.controller";

/** Minimal fakes for the collaborators the controller resolves identity through. */
function buildController() {
  const tokens = {
    issue: jest.fn().mockReturnValue({
      token: "tok",
      expiresInSeconds: 60,
      expiresAt: "2026-06-26T00:01:00.000Z",
      identity: { kind: "guest", id: "g1" },
    }),
  };
  const auth = {
    resolveUserId: jest
      .fn()
      .mockImplementation(async (cookie?: string) => cookie ?? null),
  };
  const guestSessions = {
    resolveSessionId: jest
      .fn()
      .mockImplementation(async (cookie?: string) => cookie ?? null),
  };
  const rateLimitService = new RateLimitService(new InMemoryRateLimitStore());
  const controller = new RealtimeController(
    tokens as never,
    auth as never,
    guestSessions as never,
    rateLimitService,
  );
  return { controller, tokens };
}

function guestRequest(): Request {
  return { cookies: { [GUEST_COOKIE_NAME]: "g1" } } as unknown as Request;
}

function userRequest(): Request {
  return { cookies: { [USER_COOKIE_NAME]: "u1" } } as unknown as Request;
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as Response;
  return { res, headers };
}

describe("RealtimeController reconnect throttle (stories 142-144)", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  it("issues a token while under the reconnect limit", async () => {
    const { controller, tokens } = buildController();
    const { res } = fakeResponse();

    const result = await controller.issueToken(guestRequest(), res);
    expect(result.token).toBe("tok");
    expect(tokens.issue).toHaveBeenCalledTimes(1);
  });

  it("throws 429 with a Retry-After header once a guest exceeds the limit", async () => {
    const { controller } = buildController();
    const limit = rateLimits.reconnect.guest.limit;

    // Spend the whole guest budget.
    for (let i = 0; i < limit; i += 1) {
      const { res } = fakeResponse();
      await controller.issueToken(guestRequest(), res);
    }

    const { res, headers } = fakeResponse();
    await expect(controller.issueToken(guestRequest(), res)).rejects.toThrow(
      HttpException,
    );
    expect(headers["Retry-After"]).toBeDefined();
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("sets the 429 status and a retry hint in the body", async () => {
    const { controller } = buildController();
    const limit = rateLimits.reconnect.guest.limit;
    for (let i = 0; i < limit; i += 1) {
      const { res } = fakeResponse();
      await controller.issueToken(guestRequest(), res);
    }

    const { res } = fakeResponse();
    try {
      await controller.issueToken(guestRequest(), res);
      throw new Error("expected a throttle");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const http = error as HttpException;
      expect(http.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(
        (http.getResponse() as { retryAfterSeconds: number }).retryAfterSeconds,
      ).toBeGreaterThan(0);
    }
  });

  it("does not let a guest's reconnect spend exhaust a logged-in user's budget", async () => {
    const { controller } = buildController();
    const guestLimit = rateLimits.reconnect.guest.limit;

    // Burn the guest budget entirely.
    for (let i = 0; i <= guestLimit; i += 1) {
      const { res } = fakeResponse();
      await controller.issueToken(guestRequest(), res).catch(() => undefined);
    }

    // A logged-in user with the same number of attempts is still served (higher,
    // separately-keyed ceiling) — login is no bypass but is not penalized either.
    const { res } = fakeResponse();
    await expect(
      controller.issueToken(userRequest(), res),
    ).resolves.toMatchObject({ token: "tok" });
  });
});
