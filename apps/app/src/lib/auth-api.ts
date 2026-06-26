import type {
  AvatarChangeStatus,
  DisplayIdentity,
  DisplayNameChangeStatus,
  GenderFilter,
  LanguageCode,
  OnboardingStatus,
  UserGender,
  UserPreferences
} from "@fahhhchat/config";

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
  /** Generated anonymous name + avatar shown in place of Google identity. */
  identity: DisplayIdentity;
  /** Whether the once-per-day display-name change is currently available. */
  displayNameChange: DisplayNameChangeStatus;
  /** Whether the once-per-day avatar change is currently available. */
  avatarChange: AvatarChangeStatus;
  /** Matching/UI language and gender preferences (stories 27-29). */
  preferences: UserPreferences;
  /** Whether lightweight language + gender onboarding is still owed. */
  onboarding: OnboardingStatus;
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

/**
 * Changes the account's display name. The server moderates the name and enforces
 * the once-per-day limit, surfacing a human-readable error otherwise.
 */
export async function changeUserDisplayName(displayName: string): Promise<AppUser> {
  const res = await fetch(`${API_URL}/auth/username`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName })
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as AppUser;
}

/**
 * Changes the account's avatar to an entry from the built-in set. The server
 * validates the selection and enforces the once-per-day limit, surfacing a
 * human-readable error otherwise.
 */
export async function changeUserAvatar(avatarId: string, backgroundColor: string): Promise<AppUser> {
  const res = await fetch(`${API_URL}/auth/avatar`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatarId, backgroundColor })
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as AppUser;
}

/**
 * Saves the account's matching language and gender (and optional separate UI
 * language) for onboarding or a later edit. The server validates against the
 * supported sets and surfaces a human-readable error otherwise.
 */
export async function saveUserPreferences(input: {
  matchingLanguage: LanguageCode;
  gender: UserGender;
  uiLanguage?: LanguageCode;
  genderFilter?: GenderFilter;
}): Promise<AppUser> {
  const res = await fetch(`${API_URL}/auth/preferences`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
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
