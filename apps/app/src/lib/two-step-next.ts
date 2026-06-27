import { productConfig } from "@fahhhchat/config";

/**
 * The client half of the two-step Next control (issue #26, stories 49-51). Next
 * permanently closes the current match and requeues the user, so a single stray
 * click must never end a live chat. This module is that guard: the *first* click
 * only **arms** a temporary Confirm state (story 49); a *second* click within
 * {@link productConfig.nextConfirmSeconds} **commits** the Next (story 51); and if
 * the window lapses untouched the control reverts to idle so the first click is
 * reversible (story 50). A click that arrives *after* the window has lapsed is
 * treated as a fresh first click — it re-arms rather than commits — so an
 * accidental double-click separated by a long pause can never slip through as a
 * commit.
 *
 * Like {@link import("./outgoing-messages").OutgoingMessageTracker} and
 * {@link import("./message-segments")}, it is a deliberately pure, framework-
 * agnostic state machine: no React, no timers, no sockets. A chat view drives it —
 * {@link TwoStepNext.press} on each Next click, {@link TwoStepNext.expire} from a
 * timer armed for {@link NextPressResult.expiresAt}, {@link TwoStepNext.reset}
 * when the match ends for any other reason — and renders {@link TwoStepNext.state}
 * (idle label vs. "Tap to confirm"). On a committed press the caller emits the
 * `match:next` realtime event and then requeues via the matchmaking join path;
 * the requeue is the same path any user takes to enter the pool, so it is not
 * modelled here. Keeping the gesture pure makes the accidental-click guard the
 * slice exists for fully unit-testable without a DOM or a clock.
 *
 * Correctness never depends on the expiry *timer* firing: {@link press}
 * re-evaluates the deadline against the supplied clock, so even if a timer is
 * delayed or never fires, a too-late second click still re-arms rather than
 * commits — the same "trust the clock, not the timer" stance the server takes for
 * the reconnect grace window (issue #25).
 */

/**
 * State of the two-step Next control:
 *
 * - `idle` — resting. The button shows the plain "Next" affordance; a press here
 *   arms the confirm window rather than ending anything (story 49).
 * - `confirm` — armed. The first click landed and the window is open; the button
 *   shows a "Tap to confirm" affordance and a press here (while still within the
 *   window) commits the Next (story 51). Reverts to `idle` on {@link
 *   TwoStepNext.expire} once the window lapses (story 50).
 */
export type NextConfirmState = "idle" | "confirm";

/**
 * The outcome of a {@link TwoStepNext.press}, so the caller knows what to render
 * and whether to act. {@link committed} is the only signal that the Next actually
 * fired — true only for the confirmed second click within the window — at which
 * point the caller emits `match:next` and requeues. When `committed` is false the
 * press merely (re)armed the confirm window, and {@link expiresAt} carries the new
 * deadline so the caller can (re)arm its revert timer.
 */
export interface NextPressResult {
  /** The control's state immediately after this press. */
  state: NextConfirmState;
  /** True only when this press committed the Next (the confirmed second click). */
  committed: boolean;
  /**
   * When the confirm window lapses (ISO 8601) — present only while the resulting
   * {@link state} is `confirm`, null once a press commits (back to idle). The
   * caller arms a timer for this instant and calls {@link TwoStepNext.expire} so
   * an untouched confirm reverts to idle (story 50).
   */
  expiresAt: string | null;
}

/**
 * Tracks the two-step Next gesture for a single match. One instance is scoped to
 * one match; a new match starts a new instance (mirroring the API's match-scoped,
 * ephemeral state). All decisions are made against a caller-supplied clock so the
 * machine stays pure and testable.
 */
export class TwoStepNext {
  private confirmState: NextConfirmState = "idle";

  /**
   * Epoch ms at which the open confirm window lapses, or null when {@link
   * confirmState} is `idle`. The authoritative deadline — {@link press} and {@link
   * expire} both compare against it rather than trusting a UI timer to have fired.
   */
  private confirmExpiresAt: number | null = null;

  /**
   * Register a Next click. Arms the confirm window from `idle` (story 49), or
   * commits the Next from an *unexpired* `confirm` (story 51). A click from a
   * `confirm` whose window has already lapsed is treated as a fresh first click
   * and re-arms instead of committing (story 50), so a too-late second click can
   * never end the chat. Returns the resulting state, whether it committed, and the
   * new confirm deadline (if any).
   */
  press(now: Date = new Date()): NextPressResult {
    const nowMs = now.getTime();
    const withinWindow =
      this.confirmState === "confirm" &&
      this.confirmExpiresAt !== null &&
      nowMs < this.confirmExpiresAt;

    if (withinWindow) {
      // Confirmed second click within the window: commit and reset to idle so the
      // caller can fire `match:next` + requeue and the control returns to rest.
      this.confirmState = "idle";
      this.confirmExpiresAt = null;
      return { state: "idle", committed: true, expiresAt: null };
    }

    // First click (or a re-arm after the window lapsed): open a fresh window.
    this.confirmState = "confirm";
    this.confirmExpiresAt = nowMs + productConfig.nextConfirmSeconds * 1000;
    return {
      state: "confirm",
      committed: false,
      expiresAt: new Date(this.confirmExpiresAt).toISOString(),
    };
  }

  /**
   * Revert an armed confirm window to idle if it has lapsed (story 50), the action
   * a UI timer drives. Returns true when it actually reverted (so the caller can
   * re-render the idle label), false when there was nothing to do — already idle,
   * or the window has not yet lapsed, so an early/spurious timer can't cancel a
   * still-valid confirm.
   */
  expire(now: Date = new Date()): boolean {
    if (
      this.confirmState !== "confirm" ||
      this.confirmExpiresAt === null ||
      now.getTime() < this.confirmExpiresAt
    ) {
      return false;
    }
    this.confirmState = "idle";
    this.confirmExpiresAt = null;
    return true;
  }

  /**
   * Force the control back to idle regardless of state — used when the match ends
   * for some *other* reason (the partner left, a disconnect, report/block) while a
   * confirm window happened to be open, so a stale "Tap to confirm" never lingers
   * into the next match. Idempotent.
   */
  reset(): void {
    this.confirmState = "idle";
    this.confirmExpiresAt = null;
  }

  /** The current control state, for rendering the right Next affordance. */
  get state(): NextConfirmState {
    return this.confirmState;
  }

  /**
   * The open confirm window's deadline (ISO 8601), or null while idle. Lets a view
   * that mounts mid-confirm (re)arm its revert timer without having retained the
   * {@link NextPressResult}.
   */
  get expiresAt(): string | null {
    return this.confirmExpiresAt === null
      ? null
      : new Date(this.confirmExpiresAt).toISOString();
  }
}
