import { reportDefaultsAlsoBlock } from "@fahhhchat/config";
import {
  blockIntent,
  createReportDraft,
  reportIntent,
  setReportAlsoBlock,
} from "./report-draft";

/**
 * Unit coverage for the client-side Report/Block helpers (issue #27). The
 * behaviours the slice exists to guarantee: the "also block" box defaults on
 * (story 56), the reporter can uncheck it to report without blocking, and the
 * two actions produce distinct, server-resolvable intents (stories 53, 55).
 */
describe("report-draft", () => {
  it("opens a report with also-block checked by default (story 56)", () => {
    expect(createReportDraft().alsoBlock).toBe(true);
    // Pinned to the shared default so client and API never drift apart.
    expect(createReportDraft().alsoBlock).toBe(reportDefaultsAlsoBlock);
  });

  it("lets the reporter uncheck also-block, immutably", () => {
    const draft = createReportDraft();
    const unchecked = setReportAlsoBlock(draft, false);

    expect(unchecked.alsoBlock).toBe(false);
    // The original draft is unchanged — a view can compare/replace predictably.
    expect(draft.alsoBlock).toBe(true);
  });

  it("can re-check also-block after unchecking", () => {
    const draft = setReportAlsoBlock(createReportDraft(), false);
    expect(setReportAlsoBlock(draft, true).alsoBlock).toBe(true);
  });

  it("builds a report intent carrying the explicit also-block choice (story 56)", () => {
    expect(reportIntent(createReportDraft())).toEqual({
      kind: "report",
      alsoBlock: true,
    });
    expect(
      reportIntent(setReportAlsoBlock(createReportDraft(), false)),
    ).toEqual({ kind: "report", alsoBlock: false });
  });

  it("builds a block intent with no options (stories 53, 55)", () => {
    expect(blockIntent()).toEqual({ kind: "block" });
  });
});
