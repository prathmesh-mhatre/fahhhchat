import { productConfig, type DisplayNameChangeStatus } from "@fahhhchat/config";

/**
 * Once-per-day rename cooldown (story 16), shared by the guest and logged-in
 * services so guests and accounts enforce the same window. Pure and
 * time-injectable for testing.
 */
const COOLDOWN_MS = productConfig.displayNameChangeCooldownHours * 60 * 60 * 1000;

/**
 * Compute whether a display-name change is allowed given when it last changed.
 * `lastChangedAt` is undefined for an identity that has never been renamed
 * (the generated name doesn't count), in which case a change is always allowed.
 */
export function displayNameChangeStatus(
  lastChangedAt: string | undefined,
  now: Date = new Date()
): DisplayNameChangeStatus {
  if (!lastChangedAt) {
    return { allowed: true, nextAllowedAt: null };
  }
  const nextAllowedMs = new Date(lastChangedAt).getTime() + COOLDOWN_MS;
  if (now.getTime() >= nextAllowedMs) {
    return { allowed: true, nextAllowedAt: null };
  }
  return { allowed: false, nextAllowedAt: new Date(nextAllowedMs).toISOString() };
}
