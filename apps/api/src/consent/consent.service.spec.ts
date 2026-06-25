import { createHmac } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { ConsentService } from "./consent.service";

/**
 * Re-create the consent cookie format with the test secret so specs can forge a
 * decision for an arbitrary (e.g. older) policy version. Mirrors the private
 * sign() in ConsentService; if that format changes this helper must too.
 */
function signDecision(decision: object, secret = "test-secret"): string {
  const payload = Buffer.from(JSON.stringify(decision)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

describe("ConsentService", () => {
  let service: ConsentService;

  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret";
  });

  beforeEach(() => {
    service = new ConsentService();
  });

  describe("region resolution", () => {
    it("prefers the explicit override, then CDN headers, and uppercases", () => {
      expect(
        service.resolveRegion({ override: "de", cfIpCountry: "US" })
      ).toBe("DE");
      expect(service.resolveRegion({ cfIpCountry: "us" })).toBe("US");
      expect(service.resolveRegion({ vercelIpCountry: "fr" })).toBe("FR");
    });

    it("returns 'unknown' for missing or sentinel country codes", () => {
      expect(service.resolveRegion({})).toBe("unknown");
      expect(service.resolveRegion({ cfIpCountry: "XX" })).toBe("unknown");
      expect(service.resolveRegion({ cfIpCountry: "T1" })).toBe("unknown");
      expect(service.resolveRegion({ cfIpCountry: "notacode" })).toBe("unknown");
    });
  });

  describe("regime", () => {
    it("treats EEA/UK regions as opt-in and others as opt-out", () => {
      expect(service.regimeFor("DE")).toBe("opt_in");
      expect(service.regimeFor("GB")).toBe("opt_in");
      expect(service.regimeFor("US")).toBe("opt_out");
      expect(service.regimeFor("IN")).toBe("opt_out");
    });

    it("defaults an unknown region to opt-in (privacy-first)", () => {
      expect(service.regimeFor("unknown")).toBe("opt_in");
    });
  });

  describe("default status before any decision", () => {
    it("keeps analytics off and requires a decision in opt-in regions", () => {
      const status = service.status("DE", undefined);
      expect(status).toEqual({
        version: productConfig.consentVersion,
        region: "DE",
        regime: "opt_in",
        essential: true,
        analytics: false,
        required: true,
        decidedAt: null
      });
    });

    it("allows analytics under implied consent but still prompts in opt-out regions", () => {
      const status = service.status("US", undefined);
      expect(status).toMatchObject({
        regime: "opt_out",
        analytics: true,
        required: true,
        decidedAt: null
      });
    });
  });

  describe("essential vs analytics gating", () => {
    it("always allows essential events, even before consent", () => {
      const status = service.status("DE", undefined);
      expect(service.isAllowed(status, "essential")).toBe(true);
      expect(service.isAllowed(status, "analytics")).toBe(false);
    });

    it("allows analytics only once the visitor's effective consent is on", () => {
      const optedIn = service.decide("DE", productConfig.consentVersion, true);
      expect(service.isAllowed(optedIn.status, "analytics")).toBe(true);

      const optedOut = service.decide("US", productConfig.consentVersion, false);
      expect(service.isAllowed(optedOut.status, "analytics")).toBe(false);
      expect(service.isAllowed(optedOut.status, "essential")).toBe(true);
    });
  });

  describe("recording and reading back a decision", () => {
    it("honors a stored decision under the current policy version", () => {
      const { cookieValue, status } = service.decide("DE", productConfig.consentVersion, true);
      expect(status).toMatchObject({ analytics: true, required: false });
      expect(status.decidedAt).toEqual(expect.any(String));

      const readBack = service.status("DE", cookieValue);
      expect(readBack).toMatchObject({
        analytics: true,
        required: false,
        decidedAt: status.decidedAt
      });
    });

    it("rejects a decision for a stale policy version", () => {
      expect(() => service.decide("DE", "1999-old", true)).toThrow(BadRequestException);
    });

    it("rejects a non-boolean analytics choice", () => {
      expect(() => service.decide("DE", productConfig.consentVersion, "yes")).toThrow(
        BadRequestException
      );
    });
  });

  describe("version re-acceptance", () => {
    it("re-prompts and reverts to the regime default when the stored version is stale", () => {
      // A validly-signed decision from a previous policy version must be ignored.
      const stale = signDecision({
        version: "2000-ancient",
        analytics: true,
        decidedAt: "2000-01-01T00:00:00.000Z"
      });

      expect(service.status("DE", stale)).toMatchObject({
        version: productConfig.consentVersion,
        required: true,
        analytics: false, // opt-in regime default until re-accepted
        decidedAt: null
      });
      expect(service.status("US", stale)).toMatchObject({
        required: true,
        analytics: true, // opt-out regime default
        decidedAt: null
      });
    });

    it("ignores a tampered cookie and falls back to requiring a decision", () => {
      const { cookieValue } = service.decide("DE", productConfig.consentVersion, true);
      expect(service.status("DE", `${cookieValue}x`)).toMatchObject({
        required: true,
        analytics: false,
        decidedAt: null
      });
    });
  });
});
