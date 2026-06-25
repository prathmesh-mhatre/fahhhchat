const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface LegalAcceptanceStatus {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
}

export interface SafetyGuidelinesStatus {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  reason: "first_time" | "version_changed" | "enforcement" | null;
}

/** Client-facing logged-in user. Deliberately carries no Google identity. */
export interface AppUser {
  loggedIn: true;
  userId: string;
  legal: LegalAcceptanceStatus;
  safety: SafetyGuidelinesStatus;
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return body.message ?? "Something went wrong. Please try again.";
}

/**
 * Exchanges the Google ID token (from the NextAuth session) for an internal user
 * and the backend `fc_user` session cookie. Must run in the browser so the cookie
 * is set on the user's session.
 */
export async function establishBackendSession(idToken: string): Promise<AppUser> {
  const res = await fetch(`${API_URL}/auth/google`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as AppUser;
}

/** Returns the current logged-in user, or null if no backend session exists. */
export async function fetchAppUser(): Promise<AppUser | null> {
  const res = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
  return res.status === 200 ? ((await res.json()) as AppUser) : null;
}

/** Persists the account's 18+/legal acceptance. */
export async function acceptUserLegal(legalVersion: string): Promise<AppUser> {
  const res = await fetch(`${API_URL}/auth/legal/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ageConfirmed: true, legalVersion })
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as AppUser;
}

/** Clears the backend app session cookie. */
export async function logoutBackendSession(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}
