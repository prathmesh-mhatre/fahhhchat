"use client";

import {
  resolveCameraAffordance,
  type CameraAffordanceInputs,
} from "../lib/camera-eligibility";

/**
 * The in-chat camera affordance (issue #38, stories 97, 125-126). Media sharing
 * is a *post-match* capability available only when BOTH matched users are logged
 * in and the `camera_media` kill switch is on. The PRD is explicit that the
 * affordance must stay *visible but locked* when unavailable — never hidden — and
 * that a locked affordance must explain *why* (login needed vs. kill switch off).
 *
 * This slice renders only the eligibility gate and the locked-state copy. The
 * actual capture, consent, and WebRTC transfer land in later slices
 * (#39/#40/#42); when available the button invokes the optional {@link onStart}
 * hook those slices will supply, and does nothing until then.
 *
 * Accessibility (PRD story set): the control is always a real, keyboard-focusable
 * `<button>` with a visible focus ring. When locked it is *not* `disabled`
 * (which would drop it from the tab order and hide the reason from some screen
 * readers); instead it is `aria-disabled`, inert on click/Enter, and its
 * accessible name spells out why it is locked, with a fuller description wired
 * via `aria-describedby`.
 */
export function CameraAffordance({
  inputs,
  onStart,
}: {
  inputs: CameraAffordanceInputs;
  /** Invoked when the (unlocked) affordance is activated — wired in #39. */
  onStart?: () => void;
}) {
  const state = resolveCameraAffordance(inputs);
  const describedById = "camera-affordance-reason";

  if (state.available) {
    return (
      <div className="camera-affordance">
        <button
          type="button"
          className="camera-button"
          aria-label="Share your camera"
          onClick={() => onStart?.()}
        >
          <span className="camera-glyph" aria-hidden="true">
            📷
          </span>
          <span>Camera</span>
        </button>
      </div>
    );
  }

  return (
    <div className="camera-affordance">
      <button
        type="button"
        className="camera-button is-locked"
        aria-disabled="true"
        aria-label={`Camera sharing locked. ${state.lockedLabel}`}
        aria-describedby={describedById}
        onClick={(event) => event.preventDefault()}
      >
        <span className="camera-glyph" aria-hidden="true">
          🔒
        </span>
        <span>Camera</span>
      </button>
      <p id={describedById} className="camera-locked-hint">
        {state.lockedDescription}
      </p>
    </div>
  );
}
