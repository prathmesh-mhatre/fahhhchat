"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Button, ButtonLink, Eyebrow, Surface } from "@fahhhchat/ui";
import { productConfig } from "@fahhhchat/config";
import {
  acceptUserLegal,
  establishBackendSession,
  fetchAppUser,
  logoutBackendSession,
  type AppUser
} from "../../lib/auth-api";

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000";
const DEV_MODE = process.env.NEXT_PUBLIC_AUTH_DEV_MODE === "true";

type ViewState = "loading" | "signed-out" | "establishing" | "legal" | "ready";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const [view, setView] = useState<ViewState>("loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [isAdult, setIsAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Pick the next view from the resolved backend user. */
  function applyUser(next: AppUser | null) {
    setUser(next);
    if (!next) {
      setView("signed-out");
      return;
    }
    setView(next.legal.required ? "legal" : "ready");
  }

  // On load, resolve any persisted backend session first (logged-in identity
  // persists across visits via the fc_user cookie).
  useEffect(() => {
    let active = true;
    fetchAppUser()
      .then((existing) => {
        if (!active) return;
        if (existing) {
          applyUser(existing);
        } else {
          setView("signed-out");
        }
      })
      .catch(() => active && setView("signed-out"));
    return () => {
      active = false;
    };
  }, []);

  // When NextAuth has authenticated but the backend session is not yet
  // established, exchange the Google ID token for an internal user.
  useEffect(() => {
    if (user || status !== "authenticated") return;
    const idToken = (session as { idToken?: string } | null)?.idToken;
    if (!idToken) return;

    let active = true;
    setView("establishing");
    establishBackendSession(idToken)
      .then((next) => active && applyUser(next))
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not complete sign-in.");
        setView("signed-out");
      });
    return () => {
      active = false;
    };
  }, [status, session, user]);

  async function handleAcceptLegal() {
    setSubmitting(true);
    setError(null);
    try {
      applyUser(await acceptUserLegal(productConfig.legalVersion));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await logoutBackendSession();
    setUser(null);
    await signOut({ redirect: false });
    setView("signed-out");
  }

  return (
    <main className="chat-shell" aria-labelledby="login-title">
      <Surface className="chat-panel">
        <div className="topbar">
          <span className="presence-dot" aria-hidden="true" />
          <span>Google login</span>
        </div>

        <div className="entry">
          {(view === "loading" || view === "establishing") && (
            <p aria-live="polite">
              {view === "establishing" ? "Finishing sign-in…" : "Checking your session…"}
            </p>
          )}

          {view === "signed-out" && (
            <>
              <Eyebrow className="eyebrow">Optional upgrade</Eyebrow>
              <h1 id="login-title">Sign in privately</h1>
              <p>
                Signing in with Google unlocks persistent identity, preferences, and consent-based
                camera media. Matched strangers never see your Google name, email, or photo.
              </p>

              {error && (
                <p role="alert" className="gate-error">
                  {error}
                </p>
              )}

              <div className="actions">
                <Button onClick={() => signIn("google")}>Sign in with Google</Button>
                {DEV_MODE && (
                  <Button variant="secondary" onClick={() => signIn("dev-mock")}>
                    Continue with a test account
                  </Button>
                )}
                <ButtonLink href="/guest" variant="secondary">
                  Continue as guest instead
                </ButtonLink>
              </div>
            </>
          )}

          {view === "legal" && (
            <>
              <Eyebrow className="eyebrow">One more step</Eyebrow>
              <h1 id="login-title">Confirm and accept</h1>
              <p>
                Fahhhchat is for adults only. Confirm your age and accept the current rules. We save
                this to your account so you won&apos;t be asked again next time.
              </p>

              <fieldset className="gate-fieldset">
                <legend className="gate-legend">Required to continue</legend>
                <label className="gate-check">
                  <input type="checkbox" checked={isAdult} onChange={(e) => setIsAdult(e.target.checked)} />
                  <span>I confirm that I am 18 years of age or older.</span>
                </label>
                <label className="gate-check">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                  />
                  <span>
                    I accept the{" "}
                    <a href={`${WWW_URL}/terms`} target="_blank" rel="noreferrer">
                      Terms
                    </a>{" "}
                    and{" "}
                    <a href={`${WWW_URL}/privacy`} target="_blank" rel="noreferrer">
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              </fieldset>

              {error && (
                <p role="alert" className="gate-error">
                  {error}
                </p>
              )}

              <div className="actions">
                <Button
                  onClick={handleAcceptLegal}
                  disabled={!isAdult || !acceptedTerms || submitting}
                  aria-disabled={!isAdult || !acceptedTerms || submitting}
                >
                  {submitting ? "Saving…" : "Confirm and continue"}
                </Button>
              </div>

              <p className="gate-version">Terms version {productConfig.legalVersion}</p>
            </>
          )}

          {view === "ready" && user && (
            <>
              <Eyebrow className="eyebrow">You&apos;re signed in</Eyebrow>
              <h1 id="login-title">Signed in privately</h1>
              <p>
                Your account is ready. You&apos;re known internally as{" "}
                <code>{user.userId}</code> — a pseudonymous id used for matching and analytics, not
                your Google identity. Preferences and entitlements persist across sessions.
              </p>
              <div className="actions">
                <ButtonLink href="/guest" variant="secondary">
                  Go to chat setup
                </ButtonLink>
                <Button variant="secondary" onClick={handleSignOut}>
                  Sign out
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="composer" aria-hidden="true">
          <span>Message composer placeholder</span>
          <button type="button">Send</button>
        </div>
      </Surface>
    </main>
  );
}
