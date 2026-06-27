import { resolveCameraAffordance } from "./camera-eligibility";

/**
 * Unit coverage for the camera-affordance eligibility gate (issue #38, stories
 * 97, 125-126). The behaviour this slice guarantees: the camera affordance is
 * usable ONLY when both matched users are logged in AND the camera-media kill
 * switch is on; otherwise it is locked and carries a distinct, human-readable
 * explanation of *which* gate is closed. The locked-vs-unlocked rendering and
 * its accessible label are driven entirely by this resolver, so testing it
 * pins the observable behaviour without a DOM.
 */
describe("resolveCameraAffordance", () => {
  it("is available when both users are logged in and the flag is on", () => {
    const state = resolveCameraAffordance({
      viewerLoggedIn: true,
      partnerLoggedIn: true,
      cameraMediaFlagEnabled: true,
    });

    expect(state.available).toBe(true);
    expect(state.lockedLabel).toBeNull();
    expect(state.lockedDescription).toBeNull();
  });

  it("is locked when the viewer is a guest, and says to sign in (story 97)", () => {
    const state = resolveCameraAffordance({
      viewerLoggedIn: false,
      partnerLoggedIn: true,
      cameraMediaFlagEnabled: true,
    });

    expect(state.available).toBe(false);
    expect(state.lockedLabel).toBe("Sign in to share your camera");
    expect(state.lockedDescription).toMatch(/both people are signed in/i);
  });

  it("is locked when the partner is a guest, and says both must sign in (story 97)", () => {
    const state = resolveCameraAffordance({
      viewerLoggedIn: true,
      partnerLoggedIn: false,
      cameraMediaFlagEnabled: true,
    });

    expect(state.available).toBe(false);
    expect(state.lockedLabel).toBe("Both people must be signed in");
    expect(state.lockedDescription).toMatch(/guest/i);
  });

  it("is locked when the camera-media flag is off, regardless of login (story 84)", () => {
    const state = resolveCameraAffordance({
      viewerLoggedIn: true,
      partnerLoggedIn: true,
      cameraMediaFlagEnabled: false,
    });

    expect(state.available).toBe(false);
    expect(state.lockedLabel).toBe("Camera sharing is currently unavailable");
  });

  it("reports the flag-off reason even when a login gate is also closed", () => {
    // The kill switch dominates: when the flag is off, no amount of signing in
    // could unlock the camera, so the explanation should not mislead the user
    // into thinking signing in would help.
    const state = resolveCameraAffordance({
      viewerLoggedIn: false,
      partnerLoggedIn: false,
      cameraMediaFlagEnabled: false,
    });

    expect(state.available).toBe(false);
    expect(state.lockedLabel).toBe("Camera sharing is currently unavailable");
  });

  it("distinguishes the guest-viewer reason from the guest-partner reason", () => {
    const viewerGuest = resolveCameraAffordance({
      viewerLoggedIn: false,
      partnerLoggedIn: true,
      cameraMediaFlagEnabled: true,
    });
    const partnerGuest = resolveCameraAffordance({
      viewerLoggedIn: true,
      partnerLoggedIn: false,
      cameraMediaFlagEnabled: true,
    });

    expect(viewerGuest.lockedLabel).not.toBe(partnerGuest.lockedLabel);
  });
});
