"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink, Eyebrow, Surface } from "@fahhhchat/ui";
import { productConfig } from "@fahhhchat/config";
import {
  acceptGuestLegal,
  acceptGuestSafety,
  changeGuestDisplayName,
  fetchGuestSession,
  type GuestAcceptance,
  type SafetyGuidelinesReason
} from "../../lib/session-api";
import { DisplayNameEditor } from "../../components/DisplayNameEditor";

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000";

type GateState = "loading" | "legal" | "safety" | "ready";

/** Concise expectations shown before the first chat (story 9). */
const SAFETY_GUIDELINES = [
  "Treat strangers with respect — no harassment, hate, or threats.",
  "No sexual content involving minors, and nothing non-consensual or exploitative.",
  "Don't share personal contact details or links; URLs stay as plain text.",
  "Use Report or Block to leave any chat that feels unsafe.",
  "Camera media is consent-based and view-once — it does not prevent screenshots."
];

/** Headline + lead copy for the safety gate, varied by why it is being shown. */
function safetyIntro(reason: SafetyGuidelinesReason | null): { heading: string; lead: string } {
  switch (reason) {
    case "version_changed":
      return {
        heading: "Updated safety guidelines",
        lead: "Our safety guidelines changed since you last accepted them. Please review the current rules before you keep chatting."
      };
    case "enforcement":
      return {
        heading: "Review our safety guidelines",
        lead: "Because of a recent enforcement action on your session, please review the safety guidelines again before continuing."
      };
    default:
      return {
        heading: "Quick safety guidelines",
        lead: "Before your first chat, here is what we expect from everyone on Fahhhchat."
      };
  }
}

export default function GuestEntryPage() {
  const [state, setState] = useState<GateState>("loading");
  const [session, setSession] = useState<GuestAcceptance | null>(null);
  const [safetyReason, setSafetyReason] = useState<SafetyGuidelinesReason | null>(null);
  const [isAdult, setIsAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Route to the next gate step based on the session's acceptance status. */
  function applySession(session: GuestAcceptance | null) {
    if (!session) {
      setState("legal");
      return;
    }
    setSession(session);
    if (session.safety.required) {
      setSafetyReason(session.safety.reason);
      setState("safety");
      return;
    }
    setState("ready");
  }

  useEffect(() => {
    let active = true;
    fetchGuestSession()
      .then((session) => active && applySession(session))
      .catch(() => active && setState("legal"));
    return () => {
      active = false;
    };
  }, []);

  async function handleAcceptLegal() {
    setSubmitting(true);
    setError(null);
    try {
      applySession(await acceptGuestLegal(productConfig.legalVersion));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcceptSafety() {
    setSubmitting(true);
    setError(null);
    try {
      applySession(await acceptGuestSafety(productConfig.safetyGuidelinesVersion));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const intro = safetyIntro(safetyReason);

  return (
    <main className="chat-shell" aria-labelledby="guest-title">
      <Surface className="chat-panel">
        <div className="topbar">
          <span className="presence-dot" aria-hidden="true" />
          <span>Guest setup</span>
        </div>

        <div className="entry">
          {state === "loading" && <p aria-live="polite">Checking your session…</p>}

          {state === "legal" && (
            <>
              <Eyebrow className="eyebrow">Before you start</Eyebrow>
              <h1 id="guest-title">Confirm and accept</h1>
              <p>
                Fahhhchat is for adults only. Confirm your age and accept the current rules to get a
                generated anonymous identity and join the queue.
              </p>

              <fieldset className="gate-fieldset">
                <legend className="gate-legend">Required to continue</legend>

                <label className="gate-check">
                  <input
                    type="checkbox"
                    checked={isAdult}
                    onChange={(e) => setIsAdult(e.target.checked)}
                  />
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

          {state === "safety" && (
            <>
              <Eyebrow className="eyebrow">Safety first</Eyebrow>
              <h1 id="guest-title">{intro.heading}</h1>
              {safetyReason === "enforcement" && (
                <p role="alert" className="gate-error">
                  Your session was recently flagged. Please re-read the guidelines below.
                </p>
              )}
              <p>{intro.lead}</p>

              <ul className="safety-list">
                {SAFETY_GUIDELINES.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <p>
                These mirror our{" "}
                <a href={`${WWW_URL}/safety`} target="_blank" rel="noreferrer">
                  Safety
                </a>{" "}
                and{" "}
                <a href={`${WWW_URL}/community-guidelines`} target="_blank" rel="noreferrer">
                  Community Guidelines
                </a>
                .
              </p>

              {error && (
                <p role="alert" className="gate-error">
                  {error}
                </p>
              )}

              <div className="actions">
                <Button onClick={handleAcceptSafety} disabled={submitting} aria-disabled={submitting}>
                  {submitting ? "Saving…" : "I understand — continue"}
                </Button>
              </div>

              <p className="gate-version">
                Safety guidelines version {productConfig.safetyGuidelinesVersion}
              </p>
            </>
          )}

          {state === "ready" && session && (
            <>
              <Eyebrow className="eyebrow">You're in</Eyebrow>
              <h1 id="guest-title">Ready to match</h1>
              <p>
                This is the anonymous name and avatar strangers will see — no setup needed. It stays
                with you for this browser session only. You can rename it once a day.
              </p>
              <DisplayNameEditor
                identity={session.identity}
                change={session.displayNameChange}
                onSave={async (displayName) => {
                  setSession(await changeGuestDisplayName(displayName));
                }}
              />
              <p>
                Your acceptance is saved for this browser session. Random matching arrives in a later
                slice — this is where the queue will begin.
              </p>
              <div className="actions">
                <ButtonLink href="/" variant="secondary">
                  Back to start
                </ButtonLink>
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
