const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface GuestAcceptance {
  accepted: true;
  legalVersion: string;
  acceptedAt: string;
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
