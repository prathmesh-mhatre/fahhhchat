import { Inject, Injectable } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";
import { REMATCH_GUARD_STORE, type RematchGuardStore } from "./rematch.types";

/**
 * The rematch-prevention guard (issue #27, stories 53-54). It is the single place
 * that decides two identities should be kept apart for a while after a safety
 * action, and the single place the matching pool asks who a joiner must avoid.
 *
 * Two collaborators use it from opposite ends:
 *   - the chat layer calls {@link preventRematch} when a user reports-with-block
 *     or blocks the stranger they were chatting with, recording a short mutual
 *     exclusion window ({@link productConfig.rematchPreventionSeconds});
 *   - the matchmaking pool calls {@link excludedKeysFor} at join time to learn
 *     which waiting strangers the joiner must not be paired with.
 *
 * It works purely in `kind:id` identity keys — the same keys matchmaking and chat
 * already use — so no identity translation is needed across the seam. All
 * state/TTL logic lives behind the {@link RematchGuardStore} so this service stays
 * thin and unit-testable, and the window value lives in shared config so the
 * single knob is in one place.
 */
@Injectable()
export class RematchGuardService {
  constructor(
    @Inject(REMATCH_GUARD_STORE) private readonly store: RematchGuardStore,
  ) {}

  /**
   * Keep two identities out of each other's matches until the rematch-prevention
   * window lapses (stories 53-54). The exclusion is mutual, so the order of the
   * two keys does not matter. A no-op for an identity against itself (a corrupted
   * call) so a user can never lock themselves out of matching.
   */
  async preventRematch(
    keyA: string,
    keyB: string,
    now: Date = new Date(),
  ): Promise<void> {
    const expiresAt = new Date(
      now.getTime() + productConfig.rematchPreventionSeconds * 1000,
    ).toISOString();
    await this.store.record(keyA, keyB, expiresAt);
  }

  /**
   * The identity keys a joiner must not be paired with right now — everyone they
   * blocked and everyone who blocked them, with lapsed exclusions already pruned.
   * The matching pool passes this straight into its pairing scan as additional
   * keys to skip. Empty (the common case) when the joiner has no active
   * exclusions.
   */
  async excludedKeysFor(
    key: string,
    now: Date = new Date(),
  ): Promise<string[]> {
    return this.store.excludedKeys(key, now);
  }
}
