import { reportContextMaxMessages } from "@fahhhchat/config";
import { InMemoryReportContextStore } from "./in-memory-report-context.store";
import { ReportContextService } from "./report-context.service";
import type { BufferedLine, CaptureReportContextInput } from "./report-context.types";

/** A buffer line as the live chat buffer would hand it over (oldest-first). */
function line(
  from: "initiator" | "responder",
  text: string,
  n: number,
): BufferedLine {
  return {
    messageId: `msg-${n}`,
    from,
    text,
    sentAt: new Date(2026, 5, 28, 12, 0, n).toISOString(),
  };
}

/** A capture input with sensible defaults; the reporter is the initiator. */
function input(
  overrides: Partial<CaptureReportContextInput> = {},
): CaptureReportContextInput {
  return {
    matchId: "m1",
    reporterKey: "user:u1",
    reportedKey: "guest:g1",
    reporterRole: "initiator",
    category: "harassment_hate",
    alsoBlock: true,
    buffer: [],
    ...overrides,
  };
}

function buildService() {
  const store = new InMemoryReportContextStore();
  const service = new ReportContextService(store);
  return { service, store };
}

describe("ReportContextService (issue #29, stories 62-64)", () => {
  const now = new Date("2026-06-28T12:30:00.000Z");

  it("snapshots the surrounding buffer as the report's text context (story 62)", async () => {
    const { service } = buildService();
    const buffer = [
      line("initiator", "hey", 1),
      line("responder", "you're gross", 2),
      line("initiator", "stop", 3),
    ];

    const context = await service.capture(input({ buffer }), now);

    expect(context.matchId).toBe("m1");
    expect(context.reporterKey).toBe("user:u1");
    expect(context.reportedKey).toBe("guest:g1");
    expect(context.category).toBe("harassment_hate");
    expect(context.alsoBlock).toBe(true);
    expect(context.capturedAt).toBe(now.toISOString());
    // Oldest-first, text preserved verbatim, ids carried across.
    expect(context.transcript).toEqual([
      { messageId: "msg-1", author: "reporter", text: "hey", sentAt: buffer[0].sentAt },
      { messageId: "msg-2", author: "reported", text: "you're gross", sentAt: buffer[1].sentAt },
      { messageId: "msg-3", author: "reporter", text: "stop", sentAt: buffer[2].sentAt },
    ]);
  });

  it("tags authorship relative to the reporter, whichever role they hold", async () => {
    const { service } = buildService();
    const buffer = [line("initiator", "a", 1), line("responder", "b", 2)];

    // Reporter is the *responder* this time: their own lines become `reporter`.
    const context = await service.capture(
      input({ reporterRole: "responder", buffer }),
      now,
    );

    expect(context.transcript.map((m) => m.author)).toEqual([
      "reported",
      "reporter",
    ]);
  });

  it("keeps only the newest reportContextMaxMessages lines (story 62, bounded)", async () => {
    const { service } = buildService();
    const buffer = Array.from({ length: reportContextMaxMessages + 5 }, (_, i) =>
      line(i % 2 === 0 ? "initiator" : "responder", `m${i}`, i),
    );

    const context = await service.capture(input({ buffer }), now);

    expect(context.transcript).toHaveLength(reportContextMaxMessages);
    // The newest are kept: the first surviving line is the 6th of the original.
    expect(context.transcript[0].text).toBe("m5");
    expect(context.transcript.at(-1)?.text).toBe(
      `m${reportContextMaxMessages + 4}`,
    );
  });

  it("captures an empty transcript when no messages were exchanged (a valid record)", async () => {
    const { service } = buildService();

    const context = await service.capture(input({ buffer: [] }), now);

    expect(context.transcript).toEqual([]);
    expect(context.reportId).toEqual(expect.any(String));
  });

  it("omits details when none were given, and carries them when present (issue #28)", async () => {
    const { service } = buildService();

    const without = await service.capture(input(), now);
    const withDetails = await service.capture(
      input({ details: "they threatened me" }),
      now,
    );

    expect(without.details).toBeUndefined();
    expect("details" in without).toBe(false);
    expect(withDetails.details).toBe("they threatened me");
  });

  it("persists the captured context so it can be read back by report id (issue #30/#35)", async () => {
    const { service } = buildService();

    const captured = await service.capture(input(), now);

    expect(await service.forReport(captured.reportId)).toEqual(captured);
    expect(await service.forReport("missing")).toBeNull();
  });

  it("exposes a reported user's report history, newest-first (issue #30)", async () => {
    const { service } = buildService();
    const first = await service.capture(
      input({ reportedKey: "guest:g1" }),
      new Date("2026-06-28T12:00:00.000Z"),
    );
    const second = await service.capture(
      input({ reportedKey: "guest:g1" }),
      new Date("2026-06-28T13:00:00.000Z"),
    );
    // A different reported user must not bleed into the history.
    await service.capture(input({ reportedKey: "guest:other" }), now);

    const history = await service.forReported("guest:g1");

    expect(history.map((c) => c.reportId)).toEqual([
      second.reportId,
      first.reportId,
    ]);
  });
});
