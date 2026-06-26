import type { DisplayIdentity, DisplayNameChangeStatus } from "@fahhhchat/config";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type SafetyGuidelinesReason = "first_time" | "version_changed" | "enforcement";

export interface SafetyGuidelinesStatus {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  reason: SafetyGuidelinesReason | null;
}

export interface GuestAcceptance {
  accepted: true;
  legalVersion: string;
  acceptedAt: string;
  /** Generated anonymous name + avatar for this guest session. */
  identity: DisplayIdentity;
  /** Whether the once-per-day display-name change is currently available. */
  displayNameChange: DisplayNameChangeStatus;
  safety: SafetyGuidelinesStatus;
}

/** Returns the current guest acceptance, or null if the gate has not been passed. */
export async function fetchGuestSession(): Promise<GuestAcceptance | null> {
  const res = await fetch(`${API_URL}/session/me`, { credentials: "include" });
  if (res.status === 200) {
    return (await res.json()) as GuestAcceptance;
  }
  return null;
}

/** Records 18+ and Terms/Privacy acceptance for the current browser session. */
export async function acceptGuestLegal(legalVersion: string): Promise<GuestAcceptance> {
  const res = await fetch(`${API_URL}/session/guest/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ageConfirmed: true, legalVersion })
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Could not record your acceptance. Please try again.");
  }

  return (await res.json()) as GuestAcceptance;
}

/**
 * Changes the guest session's display name. The server moderates the name and
 * enforces the once-per-day limit, surfacing a human-readable error otherwise.
 */
export async function changeGuestDisplayName(displayName: string): Promise<GuestAcceptance> {
  const res = await fetch(`${API_URL}/session/username`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName })
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Could not update your name. Please try again.");
  }

  return (await res.json()) as GuestAcceptance;
}

/** Records acceptance of the current safety guidelines for the active session. */
export async function acceptGuestSafety(safetyVersion: string): Promise<GuestAcceptance> {
  const res = await fetch(`${API_URL}/session/safety/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ safetyVersion })
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Could not record your acceptance. Please try again.");
  }

  return (await res.json()) as GuestAcceptance;
}
