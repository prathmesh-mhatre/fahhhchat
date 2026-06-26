import { productConfig, type AvatarChangeStatus } from "@fahhhchat/config";

/**
 * Once-per-day avatar-change cooldown (story 19), shared by the guest and
 * logged-in services so guests and accounts enforce the same window. Pure and
 * time-injectable for testing. Mirrors {@link displayNameChangeStatus} but keys
 * off the avatar's own timestamp, so renaming and re-avataring are independent.
 */
const COOLDOWN_MS = productConfig.avatarChangeCooldownHours * 60 * 60 * 1000;

/**
 * Compute whether an avatar change is allowed given when it last changed.
 * `lastChangedAt` is undefined for an identity whose avatar is still the
 * generated default (which doesn't count), in which case a change is allowed.
 */
export function avatarChangeStatus(
  lastChangedAt: string | undefined,
  now: Date = new Date()
): AvatarChangeStatus {
  if (!lastChangedAt) {
    return { allowed: true, nextAllowedAt: null };
  }
  const nextAllowedMs = new Date(lastChangedAt).getTime() + COOLDOWN_MS;
  if (now.getTime() >= nextAllowedMs) {
    return { allowed: true, nextAllowedAt: null };
  }
  return { allowed: false, nextAllowedAt: new Date(nextAllowedMs).toISOString() };
}
