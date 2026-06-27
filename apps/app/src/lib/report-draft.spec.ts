import { reportDefaultsAlsoBlock, reportDetailsMaxLength } from "@fahhhchat/config";
import {
  blockIntent,
  canSubmitReport,
  createReportDraft,
  reportIntent,
  setReportAlsoBlock,
  setReportCategory,
  setReportDetails,
} from "./report-draft";

/**
 * Unit coverage for the client-side Report/Block helpers (issues #27-28). The
 * behaviours the slice exists to guarantee: a report must be category-tagged
 * before it can be filed (story 59), but details are optional so a category-only
 * report is submittable (story 60); free-text details ride along when present and
 * are trimmed/length-capped on submit (story 61); the "also block" box defaults on
 * (story 56) and can be unchecked; and the two actions produce distinct,
 * server-resolvable intents (stories 53, 55).
 */
describe("report-draft", () => {
  it("opens a report with no category, empty details, and also-block on", () => {
    const draft = createReportDraft();
    expect(draft.category).toBeNull();
    expect(draft.details).toBe("");
    // Pinned to the shared default so client and API never drift apart (story 56).
    expect(draft.alsoBlock).toBe(true);
    expect(draft.alsoBlock).toBe(reportDefaultsAlsoBlock);
  });

  it("cannot submit until a category is chosen (story 59)", () => {
    const draft = createReportDraft();
    expect(canSubmitReport(draft)).toBe(false);
    expect(reportIntent(draft)).toBeNull();

    const chosen = setReportCategory(draft, "harassment_hate");
    expect(canSubmitReport(chosen)).toBe(true);
  });

  it("sets the category immutably", () => {
    const draft = createReportDraft();
    const chosen = setReportCategory(draft, "spam_scam");

    expect(chosen.category).toBe("spam_scam");
    expect(draft.category).toBeNull();
  });

  it("lets the reporter uncheck also-block, immutably", () => {
    const draft = setReportCategory(createReportDraft(), "other");
    const unchecked = setReportAlsoBlock(draft, false);

    expect(unchecked.alsoBlock).toBe(false);
    // The original draft is unchanged — a view can compare/replace predictably.
    expect(draft.alsoBlock).toBe(true);
  });

  it("builds a category-only report with no details field (story 60)", () => {
    const draft = setReportCategory(createReportDraft(), "underage");
    const intent = reportIntent(draft);

    expect(intent).toEqual({
      kind: "report",
      category: "underage",
      alsoBlock: true,
    });
    // No `details` key at all when none was typed.
    expect(intent && "details" in intent).toBe(false);
  });

  it("carries trimmed details and the explicit also-block choice (stories 56, 61)", () => {
    const draft = setReportAlsoBlock(
      setReportDetails(
        setReportCategory(createReportDraft(), "self_harm_threats"),
        "  kept saying alarming things  ",
      ),
      false,
    );

    expect(reportIntent(draft)).toEqual({
      kind: "report",
      category: "self_harm_threats",
      alsoBlock: false,
      details: "kept saying alarming things",
    });
  });

  it("treats whitespace-only details as no details (story 60)", () => {
    const draft = setReportDetails(
      setReportCategory(createReportDraft(), "other"),
      "   ",
    );
    const intent = reportIntent(draft);
    expect(intent && "details" in intent).toBe(false);
  });

  it("caps over-long details at the shared limit (story 61)", () => {
    const draft = setReportDetails(
      setReportCategory(createReportDraft(), "other"),
      "x".repeat(reportDetailsMaxLength + 100),
    );
    const intent = reportIntent(draft);
    expect(intent?.kind === "report" && intent.details?.length).toBe(
      reportDetailsMaxLength,
    );
  });

  it("builds a block intent with no options (stories 53, 55)", () => {
    expect(blockIntent()).toEqual({ kind: "block" });
  });
});
