import { Injectable } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { GuestSessionService } from "../session/guest-session.service";
import type { RealtimeIdentity } from "../realtime/realtime.types";
import type { DisplayNameResolver } from "./chat.types";

/**
 * The production {@link DisplayNameResolver}: resolves a realtime identity to its
 * generated display name from wherever that identity is durably kept — a
 * logged-in account ({@link AuthService}) or a guest session
 * ({@link GuestSessionService}). The chat layer uses it to learn each
 * participant's server-authoritative name once per match (story 40), so a typing
 * indicator can show the stranger's name without the client ever asserting it.
 */
@Injectable()
export class IdentityDisplayNameResolver implements DisplayNameResolver {
  constructor(
    private readonly auth: AuthService,
    private readonly guest: GuestSessionService,
  ) {}

  async resolve(identity: RealtimeIdentity): Promise<string | null> {
    if (identity.kind === "user") {
      return this.auth.getDisplayName(identity.id);
    }
    return this.guest.getDisplayNameBySessionId(identity.id);
  }
}
