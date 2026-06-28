import { reporterTrustWeights } from "@fahhhchat/config";
import { InMemoryModerationCasesStore } from "./in-memory-moderation-cases.store";
import { ModerationCasesService } from "./moderation-cases.service";
import type { OpenCaseInput } from "./moderation-cases.types";

function buildService() {
  const store = new InMemoryModerationCasesStore();
  const service = new ModerationCasesService(store);
  return { service, store };
}

/** A report ready to open a case from; overridable per test. */
function report(overrides: Partial<OpenCaseInput> = {}): OpenCaseInput {
  return {
    reportId: "r1",
    matchId: "m1",
    reporterKey: "user:u1",
    reportedKey: "guest:g9",
    category: "harassment_hate",
    reporterTrust: "logged_in",
    ...overrides,
  };
}

describe("ModerationCasesService", () => {
  describe("openFromReport (issue #30, story 65)", () => {
    it("opens an open case carrying the report's facts", async () => {
      const { service } = buildService();

      const opened = await service.openFromReport(
        report({ reportId: "r1", reportedKey: "guest:g9" }),
        new Date("2026-06-28T10:00:00.000Z"),
      );

      expect(opened.reportId).toBe("r1");
      expect(opened.matchId).toBe("m1");
      expect(opened.reporterKey).toBe("user:u1");
      expect(opened.reportedKey).toBe("guest:g9");
      expect(opened.category).toBe("harassment_hate");
      expect(opened.status).toBe("open");
      expect(opened.openedAt).toBe("2026-06-28T10:00:00.000Z");
      expect(opened.resolution).toBeUndefined();
      expect(opened.caseId).toEqual(expect.any(String));
    });

    it("freezes a higher trust weight for a logged-in reporter than a guest (story 65)", async () => {
      const { service } = buildService();

      const loggedIn = await service.openFromReport(
        report({ reportId: "r-li", reporterTrust: "logged_in" }),
      );
      const guest = await service.openFromReport(
        report({ reportId: "r-g", reporterTrust: "guest" }),
      );

      expect(loggedIn.reporterTrust).toBe("logged_in");
      expect(loggedIn.trustWeight).toBe(reporterTrustWeights.logged_in);
      expect(guest.reporterTrust).toBe("guest");
      expect(guest.trustWeight).toBe(reporterTrustWeights.guest);
      // Both count, but the logged-in report outranks the guest one.
      expect(guest.trustWeight).toBeGreaterThan(0);
      expect(loggedIn.trustWeight).toBeGreaterThan(guest.trustWeight);
    });

    it("is idempotent on the report id — a retried report reuses its case", async () => {
      const { service, store } = buildService();

      const first = await service.openFromReport(report({ reportId: "r1" }));
      const second = await service.openFromReport(report({ reportId: "r1" }));

      expect(second.caseId).toBe(first.caseId);
      const all = await store.findByReportedKey("guest:g9");
      expect(all).toHaveLength(1);
    });
  });

  describe("listOpen (issue #30, stories 65/76)", () => {
    it("orders the queue by trust weight first, newest within a tier", async () => {
      const { service } = buildService();
      // A guest report first, then two logged-in reports at increasing times.
      await service.openFromReport(
        report({ reportId: "r-guest", reporterTrust: "guest" }),
        new Date("2026-06-28T10:00:00.000Z"),
      );
      await service.openFromReport(
        report({ reportId: "r-li-old", reporterTrust: "logged_in" }),
        new Date("2026-06-28T10:01:00.000Z"),
      );
      await service.openFromReport(
        report({ reportId: "r-li-new", reporterTrust: "logged_in" }),
        new Date("2026-06-28T10:02:00.000Z"),
      );

      const queue = await service.listOpen();

      // Logged-in (higher weight) ahead of the guest; newest logged-in first.
      expect(queue.map((c) => c.reportId)).toEqual([
        "r-li-new",
        "r-li-old",
        "r-guest",
      ]);
    });

    it("excludes resolved cases so the queue holds only outstanding work (story 77)", async () => {
      const { service } = buildService();
      const a = await service.openFromReport(report({ reportId: "r-a" }));
      await service.openFromReport(report({ reportId: "r-b" }));

      await service.resolve(a.caseId, {
        outcome: "dismissed",
        resolvedBy: "mod@example.com",
      });

      const queue = await service.listOpen();
      expect(queue.map((c) => c.reportId)).toEqual(["r-b"]);
    });
  });

  describe("resolve (issue #30, story 77)", () => {
    it("records the disposition and moves the case out of the open queue", async () => {
      const { service } = buildService();
      const opened = await service.openFromReport(report({ reportId: "r1" }));

      const resolved = await service.resolve(
        opened.caseId,
        { outcome: "actioned", resolvedBy: "mod@example.com", note: "banned" },
        new Date("2026-06-28T12:00:00.000Z"),
      );

      expect(resolved?.status).toBe("resolved");
      expect(resolved?.resolution).toEqual({
        outcome: "actioned",
        resolvedBy: "mod@example.com",
        resolvedAt: "2026-06-28T12:00:00.000Z",
        note: "banned",
      });
      expect(await service.get(opened.caseId)).toEqual(resolved);
    });

    it("drops an empty/whitespace note rather than storing it", async () => {
      const { service } = buildService();
      const opened = await service.openFromReport(report({ reportId: "r1" }));

      const resolved = await service.resolve(opened.caseId, {
        outcome: "dismissed",
        resolvedBy: "mod@example.com",
        note: "   ",
      });

      expect(resolved?.resolution?.note).toBeUndefined();
    });

    it("returns null for an unknown case id", async () => {
      const { service } = buildService();
      expect(
        await service.resolve("nope", {
          outcome: "dismissed",
          resolvedBy: "mod@example.com",
        }),
      ).toBeNull();
    });
  });

  describe("forReported (repeat-abuse history)", () => {
    it("returns every case against a reported key, newest-first, including resolved", async () => {
      const { service } = buildService();
      const reportedKey = "guest:g9";
      const first = await service.openFromReport(
        report({ reportId: "r1", reportedKey }),
        new Date("2026-06-28T10:00:00.000Z"),
      );
      await service.openFromReport(
        report({ reportId: "r2", reportedKey }),
        new Date("2026-06-28T11:00:00.000Z"),
      );
      await service.openFromReport(
        report({ reportId: "r3", reportedKey: "guest:other" }),
        new Date("2026-06-28T11:30:00.000Z"),
      );
      await service.resolve(first.caseId, {
        outcome: "actioned",
        resolvedBy: "mod@example.com",
      });

      const history = await service.forReported(reportedKey);
      expect(history.map((c) => c.reportId)).toEqual(["r2", "r1"]);
      // Resolved cases are retained — prior outcomes inform repeat handling.
      expect(history.find((c) => c.reportId === "r1")?.status).toBe("resolved");
    });
  });
});
