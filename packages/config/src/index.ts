export const productConfig = {
  name: "Fahhhchat",
  apiServiceName: "fahhhchat-api",
  legalVersion: "2026-05-issue-1",
  safetyGuidelinesVersion: "2026-06-issue-6",
  reconnectGraceSeconds: 25,
  nextConfirmSeconds: 3
} as const;

export const featureFlagKeys = [
  "camera_media",
  "gender_filters",
  "guest_access",
  "queue_entry"
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];
