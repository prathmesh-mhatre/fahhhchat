import { InMemoryReportContextStore } from "./in-memory-report-context.store";
import type { ReportContext } from "./report-context.types";

function context(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    reportId: "r1",
    matchId: "m1",
    reporterKey: "user:u1",
    reportedKey: "guest:g1",
    category: "other",
    alsoBlock: true,
    capturedAt: "2026-06-28T12:00:00.000Z",
    transcript: [],
    ...overrides,
  };
}

describe("InMemoryReportContextStore", () => {
  it("saves and reads a context back by report id", async () => {
    const store = new InMemoryReportContextStore();
    const record = context();

    await store.save(record);

    expect(await store.findByReportId("r1")).toEqual(record);
    expect(await store.findByReportId("nope")).toBeNull();
  });

  it("replaces a record saved under the same report id", async () => {
    const store = new InMemoryReportContextStore();
    await store.save(context({ category: "spam_scam" }));
    await store.save(context({ category: "underage" }));

    expect((await store.findByReportId("r1"))?.category).toBe("underage");
  });

  it("returns a reported user's records newest-first, scoped to that user", async () => {
    const store = new InMemoryReportContextStore();
    await store.save(
      context({
        reportId: "r1",
        reportedKey: "guest:g1",
        capturedAt: "2026-06-28T12:00:00.000Z",
      }),
    );
    await store.save(
      context({
        reportId: "r2",
        reportedKey: "guest:g1",
        capturedAt: "2026-06-28T13:00:00.000Z",
      }),
    );
    await store.save(
      context({ reportId: "r3", reportedKey: "guest:other" }),
    );

    const history = await store.findByReportedKey("guest:g1");

    expect(history.map((c) => c.reportId)).toEqual(["r2", "r1"]);
  });

  it("returns an empty history for a user with no reports", async () => {
    const store = new InMemoryReportContextStore();

    expect(await store.findByReportedKey("guest:none")).toEqual([]);
  });
});
