"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink, Eyebrow, Surface } from "@fahhhchat/ui";
import { productConfig } from "@fahhhchat/config";
import { acceptGuestLegal, fetchGuestSession } from "../../lib/session-api";

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000";

type GateState = "loading" | "gate" | "accepted";

export default function GuestEntryPage() {
  const [state, setState] = useState<GateState>("loading");
  const [isAdult, setIsAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchGuestSession()
      .then((session) => {
        if (!active) return;
        setState(session ? "accepted" : "gate");
      })
      .catch(() => active && setState("gate"));
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await acceptGuestLegal(productConfig.legalVersion);
      setState("accepted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="chat-shell" aria-labelledby="guest-title">
      <Surface className="chat-panel">
        <div className="topbar">
          <span className="presence-dot" aria-hidden="true" />
          <span>Guest setup</span>
        </div>

        <div className="entry">
          {state === "loading" && <p aria-live="polite">Checking your session…</p>}

          {state === "gate" && (
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
                  onClick={handleSubmit}
                  disabled={!isAdult || !acceptedTerms || submitting}
                  aria-disabled={!isAdult || !acceptedTerms || submitting}
                >
                  {submitting ? "Saving…" : "Confirm and continue"}
                </Button>
              </div>

              <p className="gate-version">Terms version {productConfig.legalVersion}</p>
            </>
          )}

          {state === "accepted" && (
            <>
              <Eyebrow className="eyebrow">You're in</Eyebrow>
              <h1 id="guest-title">Ready to match</h1>
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
