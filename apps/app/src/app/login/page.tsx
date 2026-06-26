"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Button, ButtonLink, Eyebrow, Surface } from "@fahhhchat/ui";
import {
  genderFilterOptions,
  genderOptions,
  matchingLanguages,
  productConfig,
  type UserPreferences
} from "@fahhhchat/config";
import {
  acceptUserLegal,
  changeUserAvatar,
  changeUserDisplayName,
  establishBackendSession,
  fetchAppUser,
  logoutBackendSession,
  saveUserPreferences,
  type AppUser
} from "../../lib/auth-api";
import { DisplayNameEditor } from "../../components/DisplayNameEditor";
import { AvatarEditor } from "../../components/AvatarEditor";
import { OnboardingForm } from "../../components/OnboardingForm";

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000";
const DEV_MODE = process.env.NEXT_PUBLIC_AUTH_DEV_MODE === "true";

/** Human label for a stored language code, falling back to the raw code. */
function languageLabel(code: string): string {
  return matchingLanguages.find((lang) => lang.code === code)?.label ?? code;
}

/** Human label for a stored gender, or a friendly placeholder when unset. */
function genderLabel(prefs: UserPreferences): string {
  return genderOptions.find((option) => option.value === prefs.gender)?.label ?? "Not set";
}

/** Human label for the stored gender filter, falling back to the raw value. */
function genderFilterLabel(prefs: UserPreferences): string {
  return genderFilterOptions.find((option) => option.value === prefs.genderFilter)?.label ?? prefs.genderFilter;
}

type ViewState = "loading" | "signed-out" | "establishing" | "legal" | "onboarding" | "ready";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const [view, setView] = useState<ViewState>("loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [isAdult, setIsAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPrefs, setEditingPrefs] = useState(false);

  /** Pick the next view from the resolved backend user. */
  function applyUser(next: AppUser | null) {
    setUser(next);
    if (!next) {
      setView("signed-out");
      return;
    }
    // Gate order: legal/age first, then lightweight language + gender onboarding
    // (stories 27-29), then the ready state.
    if (next.legal.required) {
      setView("legal");
    } else if (next.onboarding.required) {
      setView("onboarding");
    } else {
      setView("ready");
    }
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

          {view === "onboarding" && user && (
            <>
              <Eyebrow className="eyebrow">Quick setup</Eyebrow>
              <h1 id="login-title">Set your preferences</h1>
              <p>
                Tell us your matching language and gender so matching has the right signals. You can
                change these later — and your interface language is a separate preference.
              </p>
              <OnboardingForm
                preferences={user.preferences}
                onSave={async (input) => {
                  applyUser(await saveUserPreferences(input));
                }}
              />
            </>
          )}

          {view === "ready" && user && (
            <>
              <Eyebrow className="eyebrow">You&apos;re signed in</Eyebrow>
              <h1 id="login-title">Signed in privately</h1>
              <p>
                Strangers see this generated name and avatar — never your Google name, email, or
                photo. It persists with your account across sessions, and you can rename it once a
                day.
              </p>
              <DisplayNameEditor
                identity={user.identity}
                change={user.displayNameChange}
                onSave={async (displayName) => {
                  setUser(await changeUserDisplayName(displayName));
                }}
              />
              <AvatarEditor
                identity={user.identity}
                change={user.avatarChange}
                onSave={async (avatarId, backgroundColor) => {
                  setUser(await changeUserAvatar(avatarId, backgroundColor));
                }}
              />
              <div className="prefs-card">
                <span className="identity-label">Matching preferences</span>
                {editingPrefs ? (
                  <OnboardingForm
                    preferences={user.preferences}
                    onSave={async (input) => {
                      setUser(await saveUserPreferences(input));
                      setEditingPrefs(false);
                    }}
                  />
                ) : (
                  <>
                    <dl className="prefs-list">
                      <div>
                        <dt>Matching language</dt>
                        <dd>{languageLabel(user.preferences.matchingLanguage)}</dd>
                      </div>
                      <div>
                        <dt>Gender</dt>
                        <dd>{genderLabel(user.preferences)}</dd>
                      </div>
                      <div>
                        <dt>Match with</dt>
                        <dd>{genderFilterLabel(user.preferences)}</dd>
                      </div>
                      <div>
                        <dt>Interface language</dt>
                        <dd>{languageLabel(user.preferences.uiLanguage)}</dd>
                      </div>
                    </dl>
                    <div className="actions">
                      <Button variant="secondary" onClick={() => setEditingPrefs(true)}>
                        Edit preferences
                      </Button>
                    </div>
                  </>
                )}
              </div>
              <p>
                You&apos;re known internally as <code>{user.userId}</code> — a pseudonymous id used
                for matching and analytics, not your Google identity. Preferences and entitlements
                persist across sessions.
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
