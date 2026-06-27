import { productConfig } from "@fahhhchat/config";
import { TwoStepNext } from "./two-step-next";

/**
 * Unit coverage for the client-side two-step Next control (issue #26). The three
 * behaviours the slice exists to guarantee: a first click only arms (story 49), a
 * second click within the window commits (story 51), and an untouched window
 * reverts so the first click is reversible (story 50). The rest pin down the edge
 * cases — a too-late second click, the timer-vs-clock race, and an external reset
 * — so none of the guards can regress unnoticed.
 */
describe("TwoStepNext", () => {
  const t0 = new Date("2026-06-28T12:00:00.000Z");
  /** A time `seconds` after t0. */
  const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
  const windowSeconds = productConfig.nextConfirmSeconds;

  it("starts idle", () => {
    const next = new TwoStepNext();

    expect(next.state).toBe("idle");
    expect(next.expiresAt).toBeNull();
  });

  it("only arms the confirm window on the first click (story 49)", () => {
    const next = new TwoStepNext();

    const result = next.press(t0);

    expect(result.committed).toBe(false);
    expect(result.state).toBe("confirm");
    expect(next.state).toBe("confirm");
    // The window lapses nextConfirmSeconds after the click.
    expect(result.expiresAt).toBe(at(windowSeconds).toISOString());
    expect(next.expiresAt).toBe(at(windowSeconds).toISOString());
  });

  it("commits on the second click within the window (story 51)", () => {
    const next = new TwoStepNext();
    next.press(t0);

    const result = next.press(at(windowSeconds - 0.5));

    expect(result.committed).toBe(true);
    // Committing returns the control to rest so the next match starts clean.
    expect(result.state).toBe("idle");
    expect(result.expiresAt).toBeNull();
    expect(next.state).toBe("idle");
  });

  describe("reversible confirm window (story 50)", () => {
    it("reverts to idle once the window lapses", () => {
      const next = new TwoStepNext();
      next.press(t0);

      const reverted = next.expire(at(windowSeconds));

      expect(reverted).toBe(true);
      expect(next.state).toBe("idle");
      expect(next.expiresAt).toBeNull();
    });

    it("does not revert before the window lapses", () => {
      const next = new TwoStepNext();
      next.press(t0);

      const reverted = next.expire(at(windowSeconds - 0.1));

      expect(reverted).toBe(false);
      expect(next.state).toBe("confirm");
    });

    it("expire is a no-op when idle", () => {
      const next = new TwoStepNext();

      expect(next.expire(t0)).toBe(false);
    });

    it("treats a too-late second click as a fresh first click, not a commit", () => {
      const next = new TwoStepNext();
      next.press(t0);

      // The window has lapsed but a stray timer never reverted it; the late click
      // must re-arm rather than commit so it can never end the chat (story 50).
      const result = next.press(at(windowSeconds + 1));

      expect(result.committed).toBe(false);
      expect(result.state).toBe("confirm");
      // Re-armed from the late click's clock, not the original press.
      expect(result.expiresAt).toBe(at(windowSeconds + 1 + windowSeconds).toISOString());
    });
  });

  it("resets to idle when the match ends for another reason", () => {
    const next = new TwoStepNext();
    next.press(t0);

    next.reset();

    expect(next.state).toBe("idle");
    expect(next.expiresAt).toBeNull();
  });

  it("can arm again after a commit (a fresh Next in the next match)", () => {
    const next = new TwoStepNext();
    next.press(t0);
    next.press(at(1)); // commit

    const result = next.press(at(2));

    expect(result.committed).toBe(false);
    expect(result.state).toBe("confirm");
  });
});
