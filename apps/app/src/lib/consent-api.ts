const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** How analytics consent is obtained for the visitor's region (issue #7). */
export type ConsentRegime = "opt_in" | "opt_out";

export interface ConsentStatus {
  version: string;
  region: string;
  regime: ConsentRegime;
  essential: true;
  analytics: boolean;
  required: boolean;
  decidedAt: string | null;
}

/** Current consent state for the visitor (region resolved server-side). */
export async function fetchConsent(): Promise<ConsentStatus | null> {
  try {
    const res = await fetch(`${API_URL}/consent`, { credentials: "include" });
    if (res.status === 200) {
      return (await res.json()) as ConsentStatus;
    }
  } catch {
    // Network/API down: leave consent undecided rather than block the page.
  }
  return null;
}

/** Record the analytics opt-in/opt-out decision for the current policy version. */
export async function saveConsent(version: string, analytics: boolean): Promise<ConsentStatus> {
  const res = await fetch(`${API_URL}/consent`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, analytics })
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Could not save your choice. Please try again.");
  }

  return (await res.json()) as ConsentStatus;
}
