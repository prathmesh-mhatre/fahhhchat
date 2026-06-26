"use client";

import { useMemo, useState } from "react";
import { Button } from "@fahhhchat/ui";
import {
  genderOptions,
  matchingLanguages,
  resolveLanguage,
  type LanguageCode,
  type UserGender,
  type UserPreferences
} from "@fahhhchat/config";

/**
 * Lightweight logged-in onboarding for matching language and gender (stories
 * 27-29). Matching language and UI language are presented as *separate*
 * preferences, both seeded from the browser language so the common case is one
 * confirm. Gender offers Male / Female / Prefer not to say without forcing more
 * disclosure. The server validates and is authoritative; errors surface here.
 */
export function OnboardingForm({
  preferences,
  onSave
}: {
  /** Current server-side preferences (defaults until the user sets them). */
  preferences: UserPreferences;
  /** Persist preferences; should throw an Error (message shown) on rejection. */
  onSave: (input: {
    matchingLanguage: LanguageCode;
    gender: UserGender;
    uiLanguage: LanguageCode;
  }) => Promise<void>;
}) {
  // Seed the languages from the browser the first time round (stories 26-28).
  // Once the account has onboarded (gender declared), prefer the saved
  // preferences over the browser guess so an edit shows current values.
  const browserDefault = useMemo<LanguageCode>(
    () => resolveLanguage(typeof navigator !== "undefined" ? navigator.language : undefined),
    []
  );
  const notYetOnboarded = preferences.gender === null;
  const [matchingLanguage, setMatchingLanguage] = useState<LanguageCode>(
    notYetOnboarded ? browserDefault : preferences.matchingLanguage
  );
  const [uiLanguage, setUiLanguage] = useState<LanguageCode>(
    notYetOnboarded ? browserDefault : preferences.uiLanguage
  );
  const [gender, setGender] = useState<UserGender | "">(preferences.gender ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (gender === "") {
      setError("Choose a gender option to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave({ matchingLanguage, gender, uiLanguage });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save preferences. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="onboarding-form">
      <div className="onboarding-field">
        <label className="onboarding-label" htmlFor="matching-language">
          Matching language
        </label>
        <select
          id="matching-language"
          className="onboarding-select"
          value={matchingLanguage}
          onChange={(e) => setMatchingLanguage(e.target.value as LanguageCode)}
          disabled={submitting}
        >
          {matchingLanguages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
        <p className="onboarding-hint">
          We use this to prefer matches you can talk to. It&apos;s a preference, not a guarantee.
        </p>
      </div>

      <fieldset className="onboarding-field">
        <legend className="onboarding-label">Gender</legend>
        <div className="onboarding-options">
          {genderOptions.map((option) => (
            <label key={option.value} className="onboarding-option">
              <input
                type="radio"
                name="gender"
                value={option.value}
                checked={gender === option.value}
                onChange={() => setGender(option.value)}
                disabled={submitting}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="onboarding-field">
        <label className="onboarding-label" htmlFor="ui-language">
          Interface language
        </label>
        <select
          id="ui-language"
          className="onboarding-select"
          value={uiLanguage}
          onChange={(e) => setUiLanguage(e.target.value as LanguageCode)}
          disabled={submitting}
        >
          {matchingLanguages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
        <p className="onboarding-hint">
          Kept separate from your matching language, so the two can change independently later.
        </p>
      </div>

      {error && (
        <p role="alert" className="gate-error">
          {error}
        </p>
      )}

      <div className="actions">
        <Button onClick={handleSave} disabled={submitting} aria-disabled={submitting}>
          {submitting ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </div>
  );
}
