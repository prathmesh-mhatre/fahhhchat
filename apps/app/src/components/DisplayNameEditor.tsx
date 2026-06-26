"use client";

import { useState } from "react";
import { Button } from "@fahhhchat/ui";
import { productConfig, type DisplayIdentity, type DisplayNameChangeStatus } from "@fahhhchat/config";
import { IdentityBadge } from "./IdentityBadge";

/** Format the cooldown's next-allowed time as a friendly local string. */
function formatNextAllowed(iso: string | null): string {
  if (!iso) return "later";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "later";
  return when.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

/**
 * Shows the user's anonymous identity and lets them rename it once per day
 * (stories 16-18). The server is authoritative — it moderates the proposed name
 * and enforces the cooldown — so this surfaces server errors verbatim and uses
 * {@link DisplayNameChangeStatus} only to decide whether to offer the control.
 */
export function DisplayNameEditor({
  identity,
  change,
  label,
  onSave
}: {
  identity: DisplayIdentity;
  change: DisplayNameChangeStatus;
  label?: string;
  /** Persist the new name; should throw an Error (message shown) on rejection. */
  onSave: (displayName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(identity.displayName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setValue(identity.displayName);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await onSave(value);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your name. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="name-editor">
      <IdentityBadge identity={identity} label={label} />

      {editing ? (
        <div className="name-editor-form">
          <label className="name-editor-label" htmlFor="display-name-input">
            New display name
          </label>
          <input
            id="display-name-input"
            className="name-editor-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            minLength={productConfig.displayNameMinLength}
            maxLength={productConfig.displayNameMaxLength}
            disabled={submitting}
            autoComplete="off"
          />
          <p className="name-editor-hint">
            {productConfig.displayNameMinLength}–{productConfig.displayNameMaxLength} characters. No
            links, contact info, or handles. You can change it once a day.
          </p>

          {error && (
            <p role="alert" className="gate-error">
              {error}
            </p>
          )}

          <div className="actions">
            <Button
              onClick={handleSave}
              disabled={submitting || value.trim() === identity.displayName}
              aria-disabled={submitting || value.trim() === identity.displayName}
            >
              {submitting ? "Saving…" : "Save name"}
            </Button>
            <Button variant="secondary" onClick={cancel} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : change.allowed ? (
        <div className="actions">
          <Button variant="secondary" onClick={startEditing}>
            Edit name
          </Button>
        </div>
      ) : (
        <p className="name-editor-hint">
          You can change your name again {formatNextAllowed(change.nextAllowedAt)}.
        </p>
      )}
    </div>
  );
}
