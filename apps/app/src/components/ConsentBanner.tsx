"use client";

import { useEffect, useState } from "react";
import { Button } from "@fahhhchat/ui";
import { productConfig } from "@fahhhchat/config";
import { fetchConsent, saveConsent, type ConsentStatus } from "../lib/consent-api";

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000";

/** Region-aware lead copy: opt-in regions must choose, opt-out regions are informed. */
function leadCopy(regime: ConsentStatus["regime"]): string {
  return regime === "opt_in"
    ? "Analytics stays off until you allow it. Essential cookies that keep chat safe and working are always on."
    : "We use optional analytics to improve Fahhhchat. Essential cookies that keep chat safe and working are always on. You can opt out below.";
}

/**
 * Region-aware cookie/privacy consent banner (issue #7, user story 12). Shows
 * when the API reports a decision is required (no decision yet, or the policy
 * version changed), separates essential safety/operational cookies from optional
 * analytics, and records the visitor's analytics choice. Essential behavior runs
 * regardless of this banner.
 */
export function ConsentBanner() {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchConsent().then((s) => {
      if (active && s?.required) {
        setStatus(s);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function choose(analytics: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      await saveConsent(productConfig.consentVersion, analytics);
      setStatus(null); // Decision recorded — dismiss the banner.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your choice. Please try again.");
      setSubmitting(false);
    }
  }

  if (!status) {
    return null;
  }

  const optIn = status.regime === "opt_in";

  return (
    <div
      className="consent-banner"
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      aria-describedby="consent-desc"
    >
      <div className="consent-banner__body">
        <h2 id="consent-title" className="consent-banner__title">
          Your privacy choices
        </h2>
        <p id="consent-desc" className="consent-banner__text">
          {leadCopy(status.regime)}{" "}
          See our{" "}
          <a href={`${WWW_URL}/privacy`} target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          .
        </p>
        {error && (
          <p role="alert" className="consent-banner__error">
            {error}
          </p>
        )}
      </div>

      <div className="consent-banner__actions">
        <Button onClick={() => choose(true)} disabled={submitting} aria-disabled={submitting}>
          {submitting ? "Saving…" : optIn ? "Allow analytics" : "Accept all"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => choose(false)}
          disabled={submitting}
          aria-disabled={submitting}
        >
          {optIn ? "Essential only" : "Reject analytics"}
        </Button>
      </div>
    </div>
  );
}
