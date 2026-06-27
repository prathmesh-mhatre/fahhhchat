import {
  cameraMediaEligibility,
  cameraMediaLockMessages,
  type CameraMediaEligibility,
} from "@fahhhchat/config";

/**
 * Everything the chat UI needs to render the in-chat camera affordance for the
 * current match (issue #38, stories 97, 125-126). The affordance is *always
 * rendered* — never hidden — so this resolves to either an unlocked control or a
 * locked one carrying a human-readable explanation of why it cannot be used.
 *
 * The actual capture / consent / WebRTC flow lands in later slices (#39/#40/#42);
 * this slice computes only eligibility and the locked-state copy, so the
 * descriptor deliberately exposes nothing about capture.
 */
export interface CameraAffordanceState {
  /** True when both sides are logged in and the kill switch is on — usable. */
  available: boolean;
  /**
   * Short hint shown beside/under the affordance and used as its accessible
   * name when locked, e.g. "Both people must be signed in". Null when available
   * (the unlocked control speaks for itself).
   */
  lockedLabel: string | null;
  /**
   * Fuller explanation suitable for a tooltip / screen-reader description, e.g.
   * why the camera is locked and what (if anything) the user can do. Null when
   * available.
   */
  lockedDescription: string | null;
}

/**
 * Inputs available to the chat client post-match. `viewerLoggedIn` is the
 * client's own identity tier (it always knows this); `partnerLoggedIn` rides in
 * on the match payload (the API attaches only this one capability bit, never the
 * stranger's identity); `cameraMediaFlagEnabled` comes from the public
 * feature-flag read the web app already polls to lock operator-killed surfaces.
 */
export interface CameraAffordanceInputs {
  viewerLoggedIn: boolean;
  partnerLoggedIn: boolean;
  cameraMediaFlagEnabled: boolean;
}

/**
 * Resolve the camera affordance's UI state from the match + flag inputs. A thin
 * adapter over the shared {@link cameraMediaEligibility} gate so the eligibility
 * *rules* live once in `@fahhhchat/config` (where the API↔web contract lives) and
 * the app only maps the result to render-ready copy.
 */
export function resolveCameraAffordance(
  inputs: CameraAffordanceInputs
): CameraAffordanceState {
  const eligibility: CameraMediaEligibility = cameraMediaEligibility({
    flagEnabled: inputs.cameraMediaFlagEnabled,
    viewerLoggedIn: inputs.viewerLoggedIn,
    partnerLoggedIn: inputs.partnerLoggedIn,
  });

  if (eligibility.available) {
    return { available: true, lockedLabel: null, lockedDescription: null };
  }

  const message = cameraMediaLockMessages[eligibility.reason];
  return {
    available: false,
    lockedLabel: message.label,
    lockedDescription: message.description,
  };
}
