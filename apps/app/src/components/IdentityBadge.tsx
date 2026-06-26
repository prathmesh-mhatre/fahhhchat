import { avatarGlyph, type DisplayIdentity } from "@fahhhchat/config";

/**
 * Renders a user's generated anonymous identity — avatar + display name — the
 * way a matched stranger would see it (stories 13-15). The avatar glyph and
 * colors come from the shared `@fahhhchat/config` avatar set so the rendering
 * stays in agreement with the server that generated it.
 */
export function IdentityBadge({
  identity,
  label = "Your anonymous identity"
}: {
  identity: DisplayIdentity;
  label?: string;
}) {
  const glyph = avatarGlyph(identity.avatar.avatarId) ?? "🙂";

  return (
    <div className="identity-card">
      <span
        className="identity-avatar"
        style={{ background: identity.avatar.backgroundColor }}
        role="img"
        aria-label={`${identity.displayName} avatar`}
      >
        {glyph}
      </span>
      <span className="identity-meta">
        <span className="identity-label">{label}</span>
        <span className="identity-name">{identity.displayName}</span>
      </span>
    </div>
  );
}
