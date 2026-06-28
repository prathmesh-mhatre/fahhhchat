import { InMemoryModerationCasesStore } from "./in-memory-moderation-cases.store";
import type { ModerationCase } from "./moderation-cases.types";

/** A stored case; overridable per test. */
function aCase(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return {
    caseId: "c1",
    reportId: "r1",
    matchId: "m1",
    reporterKey: "user:u1",
    reportedKey: "guest:g9",
    category: "harassment_hate",
    reporterTrust: "logged_in",
    trustWeight: 2,
    status: "open",
    openedAt: "2026-06-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryModerationCasesStore", () => {
  it("saves and finds a case by id", async () => {
    const store = new InMemoryModerationCasesStore();
    await store.save(aCase({ caseId: "c1" }));

    expect((await store.findById("c1"))?.caseId).toBe("c1");
    expect(await store.findById("missing")).toBeNull();
  });

  it("replaces a case saved again under the same id", async () => {
    const store = new InMemoryModerationCasesStore();
    await store.save(aCase({ caseId: "c1", status: "open" }));
    await store.save(aCase({ caseId: "c1", status: "resolved" }));

    expect((await store.findById("c1"))?.status).toBe("resolved");
    expect(await store.findByReportedKey("guest:g9")).toHaveLength(1);
  });

  it("finds a case by report id", async () => {
    const store = new InMemoryModerationCasesStore();
    await store.save(aCase({ caseId: "c1", reportId: "r1" }));

    expect((await store.findByReportId("r1"))?.caseId).toBe("c1");
    expect(await store.findByReportId("r-none")).toBeNull();
  });

  describe("listOpen ordering (story 65)", () => {
    it("returns open cases by weight desc, then newest first", async () => {
      const store = new InMemoryModerationCasesStore();
      await store.save(
        aCase({
          caseId: "c-guest",
          reportId: "r-guest",
          reporterTrust: "guest",
          trustWeight: 1,
          openedAt: "2026-06-28T10:00:00.000Z",
        }),
      );
      await store.save(
        aCase({
          caseId: "c-li-old",
          reportId: "r-li-old",
          trustWeight: 2,
          openedAt: "2026-06-28T10:01:00.000Z",
        }),
      );
      await store.save(
        aCase({
          caseId: "c-li-new",
          reportId: "r-li-new",
          trustWeight: 2,
          openedAt: "2026-06-28T10:02:00.000Z",
        }),
      );

      const open = await store.listOpen();
      expect(open.map((c) => c.caseId)).toEqual([
        "c-li-new",
        "c-li-old",
        "c-guest",
      ]);
    });

    it("omits resolved cases", async () => {
      const store = new InMemoryModerationCasesStore();
      await store.save(aCase({ caseId: "c-open", reportId: "r1" }));
      await store.save(
        aCase({ caseId: "c-done", reportId: "r2", status: "resolved" }),
      );

      expect((await store.listOpen()).map((c) => c.caseId)).toEqual(["c-open"]);
    });
  });

  it("finds every case against a reported key, newest-first", async () => {
    const store = new InMemoryModerationCasesStore();
    const reportedKey = "guest:g9";
    await store.save(
      aCase({
        caseId: "c1",
        reportId: "r1",
        reportedKey,
        openedAt: "2026-06-28T10:00:00.000Z",
      }),
    );
    await store.save(
      aCase({
        caseId: "c2",
        reportId: "r2",
        reportedKey,
        openedAt: "2026-06-28T11:00:00.000Z",
      }),
    );
    await store.save(
      aCase({ caseId: "c3", reportId: "r3", reportedKey: "guest:other" }),
    );

    const history = await store.findByReportedKey(reportedKey);
    expect(history.map((c) => c.caseId)).toEqual(["c2", "c1"]);
  });
});
