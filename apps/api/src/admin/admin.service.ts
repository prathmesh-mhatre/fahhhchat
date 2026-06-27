import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { AdminRole } from "@fahhhchat/config";
import { AuthService } from "../auth/auth.service";
import {
  ADMIN_ALLOWLIST,
  ADMIN_STORE,
  type AdminContext,
  type AdminRecord,
  type AdminStore
} from "./admin.types";

/**
 * Role granted to admins seeded from the allowlist (story 83). The allowlist is
 * the *launch* access list, so it confers the day-to-day `admin` role; the
 * narrower `superadmin` role (managing other admins) is reserved for explicit
 * later grants and never handed out by a bare seed.
 */
const SEEDED_ADMIN_ROLE: AdminRole = "admin";

/**
 * Owns admin authorization (stories 82-83): seeds the initial admin allowlist on
 * boot and answers the single question the {@link import("./admin.guard").AdminGuard}
 * asks — *is the identity behind this session an admin, and with what role?*
 *
 * Admin access requires Google login **plus** a database role: this service only
 * ever consults durable admin grants, so a general Google user (no grant) is
 * never an admin. The Google email is used internally to match the allowlist and
 * is never returned to a client.
 */
@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(ADMIN_STORE) private readonly store: AdminStore,
    @Inject(ADMIN_ALLOWLIST) private readonly allowlist: readonly string[],
    private readonly auth: AuthService
  ) {}

  /** Seed the configured allowlist into the admin store on startup (story 83). */
  async onModuleInit(): Promise<void> {
    await this.seedAllowlist();
  }

  /**
   * Grant the seeded {@link SEEDED_ADMIN_ROLE} to every allowlisted email that is
   * not already an admin. Idempotent: re-running (e.g. a restart, or the same
   * email listed twice) never downgrades or duplicates an existing grant, and an
   * email already promoted to a higher role is left untouched. Returns the
   * records it created so boot/seeding can be observed in tests.
   */
  async seedAllowlist(): Promise<AdminRecord[]> {
    const created: AdminRecord[] = [];
    for (const email of this.allowlist) {
      const existing = await this.store.findByEmail(email);
      if (existing) {
        continue;
      }
      const record: AdminRecord = {
        email,
        role: SEEDED_ADMIN_ROLE,
        source: "allowlist",
        createdAt: new Date().toISOString()
      };
      await this.store.save(record);
      created.push(record);
    }
    return created;
  }

  /**
   * Resolve the admin context for an app session token, or null when the token is
   * not a logged-in user *or* that user holds no admin role. This is the AND of
   * the two PRD requirements (story 82): a valid Google-authenticated session and
   * a database admin role. Read off the durable account email (never
   * client-asserted) so admin status can never be spoofed.
   */
  async resolveAdmin(token: string | undefined): Promise<AdminContext | null> {
    const identity = await this.auth.resolveAccountIdentity(token);
    if (!identity) {
      return null;
    }
    const record = await this.store.findByEmail(identity.email);
    if (!record) {
      return null;
    }
    return { userId: identity.userId, role: record.role };
  }

  /** Whether the given Google email currently holds an admin role. */
  async isAdminEmail(email: string): Promise<boolean> {
    return (await this.store.findByEmail(email)) !== null;
  }
}
