"use client";

import { useState } from "react";
import { Button } from "@fahhhchat/ui";
import {
  avatarBackgrounds,
  avatarSet,
  type AvatarChangeStatus,
  type DisplayIdentity
} from "@fahhhchat/config";
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
 * Lets the user swap their avatar once per day, choosing a glyph and background
 * from the safe built-in set only — no uploads (stories 19-20). The server is
 * authoritative: it validates the selection against the allow-list and enforces
 * the cooldown, so this surfaces server errors verbatim and uses
 * {@link AvatarChangeStatus} only to decide whether to offer the control. A live
 * preview shows the pending identity before saving.
 */
export function AvatarEditor({
  identity,
  change,
  onSave
}: {
  identity: DisplayIdentity;
  change: AvatarChangeStatus;
  /** Persist the selection; should throw an Error (message shown) on rejection. */
  onSave: (avatarId: string, backgroundColor: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [avatarId, setAvatarId] = useState(identity.avatar.avatarId);
  const [backgroundColor, setBackgroundColor] = useState(identity.avatar.backgroundColor);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setAvatarId(identity.avatar.avatarId);
    setBackgroundColor(identity.avatar.backgroundColor);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  const unchanged =
    avatarId === identity.avatar.avatarId && backgroundColor === identity.avatar.backgroundColor;

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await onSave(avatarId, backgroundColor);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your avatar. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // The preview identity reflects the pending selection so the badge updates live.
  const preview: DisplayIdentity = {
    ...identity,
    avatar: { avatarId, backgroundColor }
  };

  return (
    <div className="avatar-editor">
      <IdentityBadge identity={editing ? preview : identity} label="Your avatar" />

      {editing ? (
        <div className="avatar-editor-form">
          <span className="avatar-editor-label" id="avatar-glyph-label">
            Choose an avatar
          </span>
          <div className="avatar-grid" role="radiogroup" aria-labelledby="avatar-glyph-label">
            {avatarSet.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                role="radio"
                aria-checked={avatar.id === avatarId}
                aria-label={avatar.id}
                className={`avatar-option${avatar.id === avatarId ? " is-selected" : ""}`}
                style={{ background: backgroundColor }}
                onClick={() => setAvatarId(avatar.id)}
                disabled={submitting}
              >
                <span aria-hidden="true">{avatar.glyph}</span>
              </button>
            ))}
          </div>

          <span className="avatar-editor-label" id="avatar-color-label">
            Background
          </span>
          <div className="avatar-swatches" role="radiogroup" aria-labelledby="avatar-color-label">
            {avatarBackgrounds.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={color === backgroundColor}
                aria-label={color}
                className={`avatar-swatch${color === backgroundColor ? " is-selected" : ""}`}
                style={{ background: color }}
                onClick={() => setBackgroundColor(color)}
                disabled={submitting}
              />
            ))}
          </div>

          <p className="avatar-editor-hint">
            Avatars come from a safe built-in set — no uploads. You can change it once a day.
          </p>

          {error && (
            <p role="alert" className="gate-error">
              {error}
            </p>
          )}

          <div className="actions">
            <Button
              onClick={handleSave}
              disabled={submitting || unchanged}
              aria-disabled={submitting || unchanged}
            >
              {submitting ? "Saving…" : "Save avatar"}
            </Button>
            <Button variant="secondary" onClick={cancel} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : change.allowed ? (
        <div className="actions">
          <Button variant="secondary" onClick={startEditing}>
            Edit avatar
          </Button>
        </div>
      ) : (
        <p className="avatar-editor-hint">
          You can change your avatar again {formatNextAllowed(change.nextAllowedAt)}.
        </p>
      )}
    </div>
  );
}
